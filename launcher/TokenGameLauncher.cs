using System;
using System.Diagnostics;
using System.IO;

internal static class TokenGameLauncher
{
    [STAThread]
    private static void Main()
    {
        var root = AppDomain.CurrentDomain.BaseDirectory;
        var dataDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "TokenGame",
            "data"
        );

        Directory.CreateDirectory(dataDir);

        var startInfo = new ProcessStartInfo
        {
            FileName = Path.Combine(root, "runtime", "node.exe"),
            Arguments = "\"" + Path.Combine(root, "apps", "server", "dist", "cli.cjs") + "\"",
            UseShellExecute = false,
            CreateNoWindow = true,
            WorkingDirectory = root
        };
        startInfo.EnvironmentVariables["TOKEN_GAME_DATA_DIR"] = dataDir;

        Process.Start(startInfo);
        Process.Start(new ProcessStartInfo
        {
            FileName = "http://127.0.0.1:3001/",
            UseShellExecute = true
        });
    }
}
