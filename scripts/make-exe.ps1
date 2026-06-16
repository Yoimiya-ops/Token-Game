$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$out = Join-Path $root 'outputs'
$bundle = Join-Path $out 'playable'
$runtime = Join-Path $bundle 'runtime'
$server = Join-Path $bundle 'apps\server\dist'
$webRoot = Join-Path $bundle 'apps\web'
$launcherSource = Join-Path $root 'launcher\TokenGameLauncher.cs'
$launcherExe = Join-Path $bundle 'TokenGameLauncher.exe'
$csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'

if (Test-Path $bundle) {
  Remove-Item -LiteralPath $bundle -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $runtime, $server, $webRoot | Out-Null

Copy-Item 'C:\Program Files\nodejs\node.exe' -Destination $runtime
Copy-Item (Join-Path $root 'apps\server\dist\index.cjs') -Destination $server
Copy-Item (Join-Path $root 'apps\server\dist\cli.cjs') -Destination $server
Copy-Item (Join-Path $root 'apps\web\dist') -Destination $webRoot -Recurse

& $csc /target:winexe /out:$launcherExe $launcherSource | Out-Null

if (-not (Test-Path $launcherExe)) {
  throw 'Launcher exe was not created.'
}
