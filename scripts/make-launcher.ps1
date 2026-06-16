$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$staging = Join-Path $root 'outputs\launcher-bundle'
$runtime = Join-Path $staging 'runtime'
$web = Join-Path $staging 'apps\web'
$server = Join-Path $staging 'apps\server\dist'
$launcher = Join-Path $root 'launcher'

if (Test-Path $staging) {
  Remove-Item -LiteralPath $staging -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $runtime, $web, $server | Out-Null

Copy-Item 'C:\Program Files\nodejs\node.exe' -Destination $runtime
Copy-Item (Join-Path $root 'apps\web\dist') -Destination $web -Recurse
Copy-Item (Join-Path $root 'apps\server\dist\index.cjs') -Destination $server
Copy-Item (Join-Path $root 'launcher\start-game.bat') -Destination $staging

$bundleFiles = Get-ChildItem $staging -Recurse -File | Sort-Object FullName
$sourceGroups = [System.Collections.Specialized.OrderedDictionary]::new()

foreach ($file in $bundleFiles) {
  $directory = $file.DirectoryName + '\'
  if (-not $sourceGroups.Contains($directory)) {
    $sourceGroups.Add($directory, (New-Object System.Collections.Generic.List[object]))
  }
  $sourceGroups[$directory].Add($file) | Out-Null
}

$generatedSed = Join-Path $root 'outputs\package.generated.sed'
$lines = [System.Collections.Generic.List[string]]::new()
$lines.Add('[Version]')
$lines.Add('Class=IEXPRESS')
$lines.Add('SEDVersion=3')
$lines.Add('[Options]')
$lines.Add('PackagePurpose=InstallApp')
$lines.Add('ShowInstallProgramWindow=0')
$lines.Add('HideExtractAnimation=1')
$lines.Add('UseLongFileName=1')
$lines.Add('InsideCompressed=0')
$lines.Add('CAB_FixedSize=0')
$lines.Add('CAB_ResvCodeSigning=0')
$lines.Add('RebootMode=N')
$lines.Add('InstallPrompt=')
$lines.Add('DisplayLicense=')
$lines.Add('FinishMessage=')
$lines.Add(("TargetName={0}" -f (Join-Path $root 'outputs\TokenGameLauncher.exe')))
$lines.Add('FriendlyName=Token Game')
$lines.Add('AppLaunched=start-game.bat')
$lines.Add('PostInstallCmd=<None>')
$lines.Add('AdminQuietInstCmd=')
$lines.Add('UserQuietInstCmd=')
$lines.Add('SourceFiles=SourceFiles')
$lines.Add('[Strings]')

$fileIndex = 0
foreach ($file in $bundleFiles) {
  $lines.Add(("FILE{0}={1}" -f $fileIndex, ('"' + $file.Name + '"')))
  $fileIndex++
}

$lines.Add('[SourceFiles]')
$groupIndex = 0
foreach ($directory in $sourceGroups.Keys) {
  $lines.Add(("SourceFiles{0}={1}" -f $groupIndex, $directory))
  $groupIndex++
}

$groupIndex = 0
$fileIndex = 0
foreach ($directory in $sourceGroups.Keys) {
  $lines.Add(("[SourceFiles{0}]" -f $groupIndex))
  foreach ($file in $sourceGroups[$directory]) {
    $currentIndex = $bundleFiles.IndexOf($file)
    $lines.Add(("%FILE{0}%=" -f $currentIndex))
  }
  $groupIndex++
}

$lines | Set-Content $generatedSed -Encoding ASCII

Start-Process -FilePath 'C:\Windows\System32\iexpress.exe' -ArgumentList "/N `"$generatedSed`"" -Wait -WindowStyle Hidden
