using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
#if WITH_LIBS
using HagiCode.Libs.Core.Discovery;
using HagiCode.Libs.Core.Process;
using HagiCode.Libs.Git;
#endif

// Usage: SpawnProbe [--repo <path>] [--iterations N] [--claude <path>] [--out <file>] [--only <prefix>] [--prompt] [--idle <seconds>] [--opt-out-throttle-at <seconds>] [--opt-out-what power,memory,io,background] [--compare]
// --prompt also runs one tiny real Claude print-mode request per iteration (it calls the API).
var options = Options.Parse(args);
var report = new Report
{
    StartedAtUtc = DateTimeOffset.UtcNow,
    Environment = Environment_.Describe(),
};

var scenarios = new List<(string Name, Func<Task> Run)>();
var results = new List<ScenarioResult>();

void Add(string name, Func<Task> run) => scenarios.Add((name, run));

var gitExe = Locate.Git();
var claudeExe = options.Claude ?? Locate.Claude();
report.GitPath = gitExe;
report.ClaudePath = claudeExe;

Add("raw.cmd-exit", () => Measure("raw.cmd-exit", options.Iterations, () => RawSpawn(Path.Combine(Environment.SystemDirectory, "cmd.exe"), ["/c", "exit", "0"], null)));
if (gitExe is not null)
{
    Add("raw.git-version", () => Measure("raw.git-version", options.Iterations, () => RawSpawn(gitExe, ["--version"], null)));
    var mingw = Locate.GitMingw(gitExe);
    if (mingw is not null)
    {
        Add("raw.git-version-mingw", () => Measure("raw.git-version-mingw", options.Iterations, () => RawSpawn(mingw, ["--version"], null)));
    }

    if (options.Repo is not null)
    {
        Add("raw.git-status", () => Measure("raw.git-status", options.Iterations, () => RawSpawn(gitExe, ["status", "--porcelain=v2", "--branch"], options.Repo)));
        Add("raw.git-ls-untracked", () => Measure("raw.git-ls-untracked", options.Iterations, () => RawSpawn(gitExe, ["ls-files", "--others", "--exclude-standard"], options.Repo)));
        Add("raw.git-status-x4-parallel", () => Measure("raw.git-status-x4-parallel", options.Iterations, async () =>
        {
            var sw = Stopwatch.StartNew();
            await Task.WhenAll(Enumerable.Range(0, 4).Select(_ => RawSpawn(gitExe, ["status", "--porcelain=v2", "--branch"], options.Repo)));
            return sw.Elapsed.TotalMilliseconds;
        }));
    }
}

if (claudeExe is not null)
{
    Add("raw.claude-version", () => Measure("raw.claude-version", Math.Max(5, options.Iterations / 2), () => RawSpawn(claudeExe, ["--version"], null)));
}

// What the resolver does: File.Exists for every PATH directory x PATHEXT entry. Missing names dominate, so time them apart from hits.
var pathDirectories = (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries).Select(d => d.Trim('"')).ToArray();
var pathExtensions = (Environment.GetEnvironmentVariable("PATHEXT") ?? ".EXE").Split(';', StringSplitOptions.RemoveEmptyEntries);
Add("fs.exists-missing-path-x-pathext", () => Measure("fs.exists-missing-path-x-pathext", options.Iterations, () => Sync(() =>
{
    var found = 0;
    foreach (var directory in pathDirectories)
    {
        foreach (var extension in pathExtensions)
        {
            found += File.Exists(Path.Combine(directory, "hagicode-probe-missing" + extension)) ? 1 : 0;
        }
    }

    return found;
})));
Add("fs.exists-hit-x100", () => Measure("fs.exists-hit-x100", options.Iterations, () => Sync(() =>
{
    var found = 0;
    for (var i = 0; i < 100; i++)
    {
        found += File.Exists(Environment.ProcessPath) ? 1 : 0;
    }

    return found;
})));
Add("fs.exists-missing-x100", () => Measure("fs.exists-missing-x100", options.Iterations, () => Sync(() =>
{
    var found = 0;
    for (var i = 0; i < 100; i++)
    {
        found += File.Exists(Path.Combine(Environment.SystemDirectory, "hagicode-probe-missing.exe")) ? 1 : 0;
    }

    return found;
})));

// File-system cost by location and by API, to tell a package virtualization layer from a .NET cost.
{
    var tempFile = Path.Combine(Path.GetTempPath(), "spawn-probe-present.txt");
    File.WriteAllText(tempFile, "x");
    var locations = new List<(string Label, string Path)>
    {
        ("system32", Path.Combine(Environment.SystemDirectory, "cmd.exe")),
        ("program-files", Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "dotnet", "dotnet.exe")),
        ("temp", tempFile),
        ("temp-missing", Path.Combine(Path.GetTempPath(), "spawn-probe-missing.txt")),
        ("probe-bin", Path.Combine(AppContext.BaseDirectory, "SpawnProbe.dll")),
    };
    if (options.Repo is not null)
    {
        locations.Add(("user-repo", Path.Combine(options.Repo, "package.json")));
        locations.Add(("user-repo-missing", Path.Combine(options.Repo, "spawn-probe-missing.json")));
    }

    var apis = new (string Name, Func<string, bool> Call)[]
    {
        ("File.Exists", FsApi.FileExists),
        ("GetFileAttributesW", FsApi.NativeAttributes),
        ("CreateFile+Close", FsApi.OpenClose),
    };
    foreach (var (label, location) in locations)
    {
        foreach (var (apiName, call) in apis)
        {
            var name = $"fs.loc.{label}.{apiName}";
            Add(name, () => Measure(name, options.Iterations, () => Sync(() =>
            {
                var found = 0;
                for (var i = 0; i < 100; i++)
                {
                    found += call(location) ? 1 : 0;
                }

                return found;
            })));
        }
    }
}

// Same work before and after this process opts out of execution-speed throttling, so the effect on child launches is visible.
if (options.Compare)
{
    async Task WaitUntil(double seconds)
    {
        var remaining = seconds - report.ElapsedSeconds();
        if (remaining > 0)
        {
            await Task.Delay(TimeSpan.FromSeconds(remaining));
        }
    }

    void Work(string phase)
    {
        Add($"compare.{phase}.file-exists-x100", () => Measure($"compare.{phase}.file-exists-x100", 20, () => Sync(() =>
        {
            for (var i = 0; i < 100; i++)
            {
                File.Exists(Environment.ProcessPath);
            }

            return null;
        })));
        if (gitExe is not null)
        {
            Add($"compare.{phase}.git-version", () => Measure($"compare.{phase}.git-version", 15, () => RawSpawn(gitExe, ["--version"], null)));
            if (options.Repo is not null)
            {
                Add($"compare.{phase}.git-status", () => Measure($"compare.{phase}.git-status", 15, () => RawSpawn(gitExe, ["status", "--porcelain=v2", "--branch"], options.Repo)));
            }
        }

        if (claudeExe is not null)
        {
            Add($"compare.{phase}.claude-version", () => Measure($"compare.{phase}.claude-version", 10, () => RawSpawn(claudeExe, ["--version"], null)));
        }

        if (options.Repo is not null)
        {
            Add($"compare.{phase}.stat-tree", () => Measure($"compare.{phase}.stat-tree", 2, () => Sync(() =>
                Directory.EnumerateFiles(options.Repo, "*", SearchOption.AllDirectories).Sum(file => new FileInfo(file).Length))));
        }
    }

    Add("compare.0-wait", async () => await WaitUntil(5));
    Work("1-throttled");
    Add("compare.2-optout", () =>
    {
        report.Environment["compareOptOut"] = PowerThrottling.OptOut();
        return Task.Delay(1500);
    });
    Work("3-opted-out");
}

// Tree work the backend does on project folders: list every file, then ask each one for its size (one metadata call per file).
if (options.Repo is not null)
{
    Add("fs.enumerate-repo-tree", () => Measure("fs.enumerate-repo-tree", Math.Min(options.Iterations, 5), () => Sync(() =>
        Directory.EnumerateFiles(options.Repo, "*", SearchOption.AllDirectories).Count())));
    Add("fs.stat-repo-tree", () => Measure("fs.stat-repo-tree", Math.Min(options.Iterations, 5), () => Sync(() =>
        Directory.EnumerateFiles(options.Repo, "*", SearchOption.AllDirectories).Sum(file => new FileInfo(file).Length))));
}

if (claudeExe is not null && options.Prompt)
{
    // The wall time includes the API round trip; claude reports that part as duration_api_ms, so wall minus it is the client's own start-up and teardown.
    var promptWall = new List<double>();
    var promptOverhead = new List<double>();
    Add("raw.claude-prompt", () => Measure("raw.claude-prompt", Math.Min(options.Iterations, 5), async () =>
    {
        var (ms, stdout) = await RawSpawnCapture(claudeExe, ["-p", "Reply with the single word ok.", "--output-format", "json"], null);
        promptWall.Add(ms);
        if (TryReadApiMs(stdout) is { } apiMs)
        {
            promptOverhead.Add(ms - apiMs);
        }

        return ms;
    }));
    Add("raw.claude-prompt-client-overhead", () =>
    {
        if (promptOverhead.Count > 0)
        {
            results.Add(ScenarioResult.From("raw.claude-prompt-client-overhead", promptOverhead));
        }

        return Task.CompletedTask;
    });
}

#if WITH_LIBS
var resolver = new CliExecutableResolver();
Add("libs.resolve.git", () => Measure("libs.resolve.git", options.Iterations, () => Sync(() => resolver.ResolveExecutablePath("git"))));
Add("libs.resolve.claude", () => Measure("libs.resolve.claude", options.Iterations, () => Sync(() => resolver.ResolveExecutablePath("claude"))));

if (options.Repo is not null)
{
    var git = new GitClient(new GitClientOptions());
    Add("libs.git.probe-dirty", () => Measure("libs.git.probe-dirty", options.Iterations, async () =>
    {
        var sw = Stopwatch.StartNew();
        await git.ProbeDirtyAsync(options.Repo);
        return sw.Elapsed.TotalMilliseconds;
    }));
    Add("libs.git.status", () => Measure("libs.git.status", options.Iterations, async () =>
    {
        var sw = Stopwatch.StartNew();
        await git.GetStatusAsync(options.Repo);
        return sw.Elapsed.TotalMilliseconds;
    }));
    // One repository refresh as the backend does it: scanner metadata, then the grain's own status load.
    Add("libs.git.refresh-sequence", () => Measure("libs.git.refresh-sequence", options.Iterations, async () =>
    {
        var sw = Stopwatch.StartNew();
        await git.GetRemoteUrlAsync(options.Repo);
        await git.GetCurrentBranchAsync(options.Repo);
        await git.ProbeDirtyAsync(options.Repo);
        await git.GetTrackingInfoAsync(options.Repo);
        await git.ProbeDirtyAsync(options.Repo);
        await git.GetStatusAsync(options.Repo);
        return sw.Elapsed.TotalMilliseconds;
    }));
}

var manager = new CliProcessManager();
if (claudeExe is not null)
{
    Add("libs.claude.version", () => Measure("libs.claude.version", Math.Max(5, options.Iterations / 2), async () =>
    {
        var sw = Stopwatch.StartNew();
        await manager.ExecuteAsync(new ProcessStartContext
        {
            ExecutablePath = claudeExe,
            Arguments = ["--version"],
            Timeout = TimeSpan.FromSeconds(30),
        });
        return sw.Elapsed.TotalMilliseconds;
    }));
}
#endif

// File.Exists x100 on this process's own executable, taken before the first scenario and after each one, so a change that
// starts at some point of the run (for example after the first child process) shows up as a step in the timeline.
double FsSample()
{
    var sw = Stopwatch.StartNew();
    for (var i = 0; i < 100; i++)
    {
        File.Exists(Environment.ProcessPath);
    }

    return Math.Round(sw.Elapsed.TotalMilliseconds, 2);
}

// A sampler that is independent of the scenarios: File.Exists x100 every 250 ms against the wall clock, plus when each scenario ran.
var clock = Stopwatch.StartNew();
using var samplerStop = new CancellationTokenSource();
var sampler = Task.Run(async () =>
{
    using var timer = new PeriodicTimer(TimeSpan.FromMilliseconds(250));
    try
    {
        while (await timer.WaitForNextTickAsync(samplerStop.Token))
        {
            var at = Math.Round(clock.Elapsed.TotalSeconds, 2);
            report.FsSeries.Add(new FsSeriesPoint { AtSeconds = at, Ms = FsSample() });
        }
    }
    catch (OperationCanceledException)
    {
    }
});

report.FsTimeline.Add(new FsPoint { After = "(start)", Ms = FsSample() });
foreach (var (name, run) in scenarios)
{
    var startedAtSeconds = Math.Round(clock.Elapsed.TotalSeconds, 2);
    if (options.Only is not null && !options.Only.Split(',').Any(prefix => name.StartsWith(prefix, StringComparison.Ordinal)))
    {
        continue;
    }

    try
    {
        await run();
    }
    catch (Exception ex)
    {
        results.Add(new ScenarioResult { Name = name, Error = ex.Message });
    }

    report.FsTimeline.Add(new FsPoint { After = name, Ms = FsSample(), StartedAtSeconds = startedAtSeconds, EndedAtSeconds = Math.Round(clock.Elapsed.TotalSeconds, 2) });
}

// Do nothing for a while so the sampler shows what the process-level baseline does without any scenario running.
if (options.IdleSeconds > 0)
{
    report.Environment["throttleAtStart"] = PowerThrottling.Describe();
    report.Environment["prioritiesAtStart"] = PowerThrottling.Priorities();
    if (options.OptOutThrottleAt is > 0 and var optOutAt && optOutAt < options.IdleSeconds)
    {
        await Task.Delay(TimeSpan.FromSeconds(optOutAt));
        report.Environment["throttleBeforeOptOut"] = PowerThrottling.Describe();
        report.Environment["optOutAtSeconds"] = Math.Round(clock.Elapsed.TotalSeconds, 2).ToString();
        var what = options.OptOutWhat.Split(',');
        report.Environment["optOutWhat"] = options.OptOutWhat;
        report.Environment["optOutResult"] = what.Contains("power") ? PowerThrottling.OptOut() : "skipped";
        report.Environment["throttleAfterOptOut"] = PowerThrottling.Describe();
        report.Environment["prioritiesBeforeOptOut"] = PowerThrottling.Priorities();
        report.Environment["optOutPriorities"] = PowerThrottling.OptOutPriorities(what);
        report.Environment["prioritiesAfterOptOut"] = PowerThrottling.Priorities();
        await Task.Delay(TimeSpan.FromSeconds(options.IdleSeconds - optOutAt));
    }
    else
    {
        await Task.Delay(TimeSpan.FromSeconds(options.IdleSeconds));
    }

    report.Environment["throttleAtEnd"] = PowerThrottling.Describe();
}

samplerStop.Cancel();
await sampler;

report.Scenarios = results;
var json = JsonSerializer.Serialize(report, new JsonSerializerOptions { WriteIndented = true });
if (options.Out is not null)
{
    File.WriteAllText(options.Out, json, new UTF8Encoding(false));
}

Console.WriteLine(json);
return 0;

async Task Measure(string name, int iterations, Func<Task<double>> action)
{
    var samples = new List<double>();
    for (var i = 0; i < iterations; i++)
    {
        samples.Add(await action());
    }

    results.Add(ScenarioResult.From(name, samples));
}

static Task<double> Sync(Func<object?> action)
{
    var sw = Stopwatch.StartNew();
    action();
    return Task.FromResult(sw.Elapsed.TotalMilliseconds);
}

// Same start settings as HagiCode.Libs GitProcessRunner / CliProcessManager: no shell, no window, every stream redirected, stdin closed at once.
static async Task<double> RawSpawn(string exe, IReadOnlyList<string> arguments, string? workingDirectory)
    => (await RawSpawnCapture(exe, arguments, workingDirectory)).Ms;

static double? TryReadApiMs(string stdout)
{
    try
    {
        using var document = JsonDocument.Parse(stdout);
        return document.RootElement.TryGetProperty("duration_api_ms", out var value) ? value.GetDouble() : null;
    }
    catch (JsonException)
    {
        return null;
    }
}

static async Task<(double Ms, string Stdout)> RawSpawnCapture(string exe, IReadOnlyList<string> arguments, string? workingDirectory)
{
    var startInfo = new ProcessStartInfo
    {
        FileName = exe,
        WorkingDirectory = workingDirectory ?? Environment.CurrentDirectory,
        UseShellExecute = false,
        CreateNoWindow = true,
        RedirectStandardInput = true,
        RedirectStandardOutput = true,
        RedirectStandardError = true,
        StandardOutputEncoding = new UTF8Encoding(false),
        StandardErrorEncoding = new UTF8Encoding(false),
    };
    foreach (var argument in arguments)
    {
        startInfo.ArgumentList.Add(argument);
    }

    var sw = Stopwatch.StartNew();
    using var process = new Process { StartInfo = startInfo };
    process.Start();
    process.StandardInput.Close();
    var stdout = process.StandardOutput.ReadToEndAsync();
    var stderr = process.StandardError.ReadToEndAsync();
    await process.WaitForExitAsync();
    await Task.WhenAll(stdout, stderr);
    return (sw.Elapsed.TotalMilliseconds, stdout.Result);
}

internal sealed record Options(string? Repo, int Iterations, string? Claude, string? Out, string? Only, bool Prompt, int IdleSeconds, int OptOutThrottleAt, string OptOutWhat, bool Compare)
{
    public static Options Parse(string[] args)
    {
        string? repo = null, claude = null, output = null, only = null;
        var iterations = 20;
        var prompt = false;
        var idle = 0;
        var optOut = 0;
        var optOutWhat = "power,memory,io,background";
        var compare = false;
        for (var i = 0; i < args.Length; i++)
        {
            switch (args[i])
            {
                case "--repo": repo = args[++i]; break;
                case "--iterations": iterations = int.Parse(args[++i]); break;
                case "--claude": claude = args[++i]; break;
                case "--out": output = args[++i]; break;
                case "--only": only = args[++i]; break;
                case "--prompt": prompt = true; break;
                case "--idle": idle = int.Parse(args[++i]); break;
                case "--opt-out-throttle-at": optOut = int.Parse(args[++i]); break;
                case "--opt-out-what": optOutWhat = args[++i]; break;
                case "--compare": compare = true; break;
            }
        }

        return new Options(repo, iterations, claude, output, only, prompt, idle, optOut, optOutWhat, compare);
    }
}

internal sealed class Report
{
    public DateTimeOffset StartedAtUtc { get; set; }
    public Dictionary<string, string?> Environment { get; set; } = [];
    public string? GitPath { get; set; }
    public string? ClaudePath { get; set; }
    public List<ScenarioResult> Scenarios { get; set; } = [];
    public List<FsPoint> FsTimeline { get; set; } = [];
    public List<FsSeriesPoint> FsSeries { get; set; } = [];
    public DateTimeOffset StartedClock { get; } = DateTimeOffset.UtcNow;

    public double ElapsedSeconds() => (DateTimeOffset.UtcNow - StartedClock).TotalSeconds;
}

internal sealed class FsSeriesPoint
{
    public double AtSeconds { get; set; }
    public double Ms { get; set; }
}

internal sealed class FsPoint
{
    public string After { get; set; } = "";
    public double Ms { get; set; }
    public double StartedAtSeconds { get; set; }
    public double EndedAtSeconds { get; set; }
}

internal sealed class ScenarioResult
{
    public string Name { get; set; } = "";
    public int Count { get; set; }
    public double FirstMs { get; set; }
    public double MinMs { get; set; }
    public double MedianMs { get; set; }
    public double P95Ms { get; set; }
    public double MaxMs { get; set; }
    public string? Error { get; set; }
    public List<double> SamplesMs { get; set; } = [];

    public static ScenarioResult From(string name, List<double> samples)
    {
        var sorted = samples.Order().ToList();
        return new ScenarioResult
        {
            Name = name,
            SamplesMs = samples.Select(v => Math.Round(v, 1)).ToList(),
            Count = samples.Count,
            FirstMs = Math.Round(samples[0], 1),
            MinMs = Math.Round(sorted[0], 1),
            MedianMs = Math.Round(sorted[sorted.Count / 2], 1),
            P95Ms = Math.Round(sorted[Math.Min(sorted.Count - 1, (int)(sorted.Count * 0.95))], 1),
            MaxMs = Math.Round(sorted[^1], 1),
        };
    }
}

internal static class Environment_
{
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetCurrentPackageFullName(ref int length, StringBuilder? name);

    public static Dictionary<string, string?> Describe()
    {
        var length = 0;
        GetCurrentPackageFullName(ref length, null);
        var builder = new StringBuilder(Math.Max(length, 1));
        var rc = OperatingSystem.IsWindows() ? GetCurrentPackageFullName(ref length, builder) : -1;
        return new Dictionary<string, string?>
        {
            ["packageFullName"] = rc == 0 ? builder.ToString() : null,
            ["os"] = RuntimeInformation.OSDescription,
            ["processPath"] = Environment.ProcessPath,
            ["currentDirectory"] = Environment.CurrentDirectory,
            ["pathEntries"] = (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries).Length.ToString(),
            ["pathext"] = Environment.GetEnvironmentVariable("PATHEXT"),
            ["elevated"] = OperatingSystem.IsWindows()
                ? new System.Security.Principal.WindowsPrincipal(System.Security.Principal.WindowsIdentity.GetCurrent()).IsInRole(System.Security.Principal.WindowsBuiltInRole.Administrator).ToString()
                : null,
        };
    }
}

// Windows can run a background process in "efficiency mode" (EcoQoS): lower clocks, efficiency cores. This reads and clears the per-process request.
internal static class PowerThrottling
{
    [StructLayout(LayoutKind.Sequential)]
    private struct State
    {
        public uint Version;
        public uint ControlMask;
        public uint StateMask;
    }

    private const int ProcessPowerThrottling = 4;
    private const uint ExecutionSpeed = 0x1;

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetProcessInformation(IntPtr process, int informationClass, out State state, int size);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetProcessInformation(IntPtr process, int informationClass, ref State state, int size);

    public static string Describe()
    {
        var handle = Process.GetCurrentProcess().Handle;
        return GetProcessInformation(handle, ProcessPowerThrottling, out var state, Marshal.SizeOf<State>())
            ? $"control=0x{state.ControlMask:x} state=0x{state.StateMask:x} (state bit 0 = execution-speed throttling {((state.StateMask & ExecutionSpeed) != 0 ? "ON" : "off")})"
            : $"GetProcessInformation failed: {Marshal.GetLastWin32Error()}";
    }

    [DllImport("kernel32.dll")]
    private static extern uint GetPriorityClass(IntPtr process);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetPriorityClass(IntPtr process, uint priorityClass);

    [DllImport("ntdll.dll")]
    private static extern int NtQueryInformationProcess(IntPtr process, int informationClass, out int value, int size, IntPtr returnLength);

    [DllImport("ntdll.dll")]
    private static extern int NtSetInformationProcess(IntPtr process, int informationClass, ref int value, int size);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetProcessInformation(IntPtr process, int informationClass, ref uint value, int size);

    private const int ProcessIoPriority = 33;
    private const int ProcessPagePriority = 39;
    private const int ProcessMemoryPriority = 0;

    /// <summary>Priority class, I/O priority (2 = normal) and page priority (5 = normal) as the system reports them.</summary>
    public static string Priorities()
    {
        var handle = Process.GetCurrentProcess().Handle;
        var priorityClass = GetPriorityClass(handle);
        var io = NtQueryInformationProcess(handle, ProcessIoPriority, out var ioValue, 4, IntPtr.Zero) == 0 ? ioValue.ToString() : "?";
        var page = NtQueryInformationProcess(handle, ProcessPagePriority, out var pageValue, 4, IntPtr.Zero) == 0 ? pageValue.ToString() : "?";
        return $"priorityClass=0x{priorityClass:x} ioPriority={io} pagePriority={page}";
    }

    /// <summary>Also restores normal priority class, I/O priority and memory priority, in case the process was put in background mode.</summary>
    public static string OptOutPriorities(string[] what)
    {
        var handle = Process.GetCurrentProcess().Handle;
        var results = new List<string>();
        if (what.Contains("background"))
        {
            results.Add("backgroundEnd=" + (SetPriorityClass(handle, 0x00200000) ? "ok" : Marshal.GetLastWin32Error().ToString()));
        }

        if (what.Contains("io"))
        {
            var io = 2;
            results.Add("io=0x" + NtSetInformationProcess(handle, ProcessIoPriority, ref io, 4).ToString("x"));
        }

        if (what.Contains("memory"))
        {
            var memory = 5u;
            results.Add("memory=" + (SetProcessInformation(handle, ProcessMemoryPriority, ref memory, 4) ? "ok" : Marshal.GetLastWin32Error().ToString()));
        }

        return string.Join(' ', results);
    }

    public static string OptOut()
    {
        var state = new State { Version = 1, ControlMask = ExecutionSpeed, StateMask = 0 };
        return SetProcessInformation(Process.GetCurrentProcess().Handle, ProcessPowerThrottling, ref state, Marshal.SizeOf<State>())
            ? "ok"
            : $"SetProcessInformation failed: {Marshal.GetLastWin32Error()}";
    }
}

internal static class FsApi
{
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetFileAttributesW(string path);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateFileW(string path, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);

    public static bool FileExists(string path) => File.Exists(path);

    public static bool NativeAttributes(string path) => GetFileAttributesW(path) != 0xFFFFFFFF;

    // Open for attribute reads only (FILE_READ_ATTRIBUTES, share all, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS).
    public static bool OpenClose(string path)
    {
        var handle = CreateFileW(path, 0x80, 7, IntPtr.Zero, 3, 0x02000000, IntPtr.Zero);
        if (handle == new IntPtr(-1))
        {
            return false;
        }

        CloseHandle(handle);
        return true;
    }
}

internal static class Locate
{
    public static string? Git() => FromPath("git.exe") ?? FromPath("git");

    public static string? Claude() => FromPath("claude.exe") ?? FromPath("claude");

    // Git for Windows' cmd\git.exe re-launches mingw64\bin\git.exe; time the real binary to see the extra hop.
    public static string? GitMingw(string gitExe)
    {
        var root = Directory.GetParent(Path.GetDirectoryName(gitExe) ?? "")?.FullName;
        var candidate = root is null ? null : Path.Combine(root, "mingw64", "bin", "git.exe");
        return candidate is not null && File.Exists(candidate) ? candidate : null;
    }

    private static string? FromPath(string name)
    {
        foreach (var directory in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries))
        {
            var candidate = Path.Combine(directory.Trim('"'), name);
            if (File.Exists(candidate))
            {
                return candidate;
            }
        }

        return null;
    }
}
