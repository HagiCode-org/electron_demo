using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
#if WITH_LIBS
using HagiCode.Libs.Core.Discovery;
using HagiCode.Libs.Core.Process;
using HagiCode.Libs.Git;
#endif

// Usage: SpawnProbe [--repo <path>] [--iterations N] [--claude <path>] [--out <file>] [--only <prefix>] [--prompt]
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

foreach (var (name, run) in scenarios)
{
    if (options.Only is not null && !name.StartsWith(options.Only, StringComparison.Ordinal))
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
}

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

internal sealed record Options(string? Repo, int Iterations, string? Claude, string? Out, string? Only, bool Prompt)
{
    public static Options Parse(string[] args)
    {
        string? repo = null, claude = null, output = null, only = null;
        var iterations = 20;
        var prompt = false;
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
            }
        }

        return new Options(repo, iterations, claude, output, only, prompt);
    }
}

internal sealed class Report
{
    public DateTimeOffset StartedAtUtc { get; set; }
    public Dictionary<string, string?> Environment { get; set; } = [];
    public string? GitPath { get; set; }
    public string? ClaudePath { get; set; }
    public List<ScenarioResult> Scenarios { get; set; } = [];
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

    public static ScenarioResult From(string name, List<double> samples)
    {
        var sorted = samples.Order().ToList();
        return new ScenarioResult
        {
            Name = name,
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
        };
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
