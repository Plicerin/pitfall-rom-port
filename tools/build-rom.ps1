# Assembles pitfall.asm (Thomas Jentzsch's annotated disassembly) with DASM and
# checks the result against the cartridge's MD5. Output:
# tools/build/pitfall.{bin,lst,sym} (git-ignored), and rom/pitfall.a26 for the
# oracle. Needs DASM 2.20.17 and vcs.h in tools/dasm.
#
# The source reads the TIA as "CXP0FB-$30" and so on, written for a vcs.h
# whose read registers sat at $30; TIA_BASE_READ_ADDRESS=$30 restores that.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $PSScriptRoot 'build'
New-Item -ItemType Directory -Force $out | Out-Null

# DASM runs in a temp folder because Windows' Controlled Folder Access stops
# it writing under Documents; the results are copied back afterwards
$tmp = Join-Path ([IO.Path]::GetTempPath()) 'pitfall-rom-build'
New-Item -ItemType Directory -Force $tmp | Out-Null
Copy-Item (Join-Path $root 'pitfall.asm') $tmp -Force
Copy-Item (Join-Path $PSScriptRoot 'dasm\vcs.h') $tmp -Force

Push-Location $tmp
try {
  # passed as an array: PowerShell mangles some DASM flags written inline
  $dasmArgs = @('pitfall.asm', '-f3', '-DTIA_BASE_READ_ADDRESS=48', '-opitfall.bin', '-lpitfall.lst', '-spitfall.sym')
  & (Join-Path $PSScriptRoot 'dasm\dasm.exe') @dasmArgs
  if ($LASTEXITCODE -ne 0) { throw "DASM failed ($LASTEXITCODE)" }
} finally { Pop-Location }
Copy-Item (Join-Path $tmp 'pitfall.bin'), (Join-Path $tmp 'pitfall.lst'), (Join-Path $tmp 'pitfall.sym') $out -Force

$md5 = (Get-FileHash (Join-Path $out 'pitfall.bin') -Algorithm MD5).Hash.ToLower()
if ($md5 -ne '3e90cf23106f2e08b2781e41299de556') { throw "assembled ROM MD5 $md5 does not match the cartridge" }
New-Item -ItemType Directory -Force (Join-Path $root 'rom') | Out-Null
Copy-Item (Join-Path $out 'pitfall.bin') (Join-Path $root 'rom\pitfall.a26') -Force
"OK: tools/build/pitfall.bin matches the cartridge ($md5)"
