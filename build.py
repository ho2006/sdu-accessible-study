"""Build the Windows x64 portable app using the Windows .NET Framework compiler."""
from pathlib import Path
import hashlib
import shutil
import subprocess
import urllib.request
import zipfile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent
BUILD = ROOT / "build"
SDK = BUILD / "sdk"
OUTPUT = ROOT / "dist" / "SDU-Accessible-Study"
VERSION = "1.0.4191.47"
URL = f"https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/{VERSION}/microsoft.web.webview2.{VERSION}.nupkg"
SDK_FILES = ("Microsoft.Web.WebView2.Core.dll", "Microsoft.Web.WebView2.WinForms.dll", "WebView2Loader.dll", "LICENSE-WebView2.txt")
PACKAGE_FILES = ("SDU-Study.exe", *SDK_FILES, "使用说明.txt", "THIRD-PARTY.txt")


def main():
    compiler = Path(r"C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe")
    if not compiler.is_file():
        raise RuntimeError("Windows x64 .NET Framework compiler was not found: " + str(compiler))
    SDK.mkdir(parents=True, exist_ok=True)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    package = BUILD / "webview2.nupkg"
    if not package.exists():
        temporary = package.with_suffix(".download")
        try:
            with urllib.request.urlopen(URL, timeout=60) as response, temporary.open("wb") as target:
                shutil.copyfileobj(response, target)
            with zipfile.ZipFile(temporary) as downloaded:
                if downloaded.testzip() is not None:
                    raise RuntimeError("SDK download is damaged; retry the build.")
            temporary.replace(package)
        finally:
            temporary.unlink(missing_ok=True)
    with zipfile.ZipFile(package) as archive:
        manifest = ET.fromstring(archive.read("Microsoft.Web.WebView2.nuspec"))
        if manifest.findtext("{*}metadata/{*}version") != VERSION:
            raise RuntimeError("Cached SDK version does not match; remove build/webview2.nupkg and retry.")
        for name in ("Microsoft.Web.WebView2.Core", "Microsoft.Web.WebView2.WinForms"):
            (SDK / f"{name}.dll").write_bytes(archive.read(f"lib/net462/{name}.dll"))
        (SDK / "WebView2Loader.dll").write_bytes(archive.read("runtimes/win-x64/native/WebView2Loader.dll"))
        (SDK / "LICENSE-WebView2.txt").write_bytes(archive.read("LICENSE.txt"))
    for name in SDK_FILES:
        shutil.copy2(SDK / name, OUTPUT / name)
    subprocess.run([
        str(compiler), "/nologo", "/target:winexe", "/platform:x64", "/optimize+", "/codepage:65001",
        "/reference:System.Windows.Forms.dll", "/reference:System.Drawing.dll",
        f"/reference:{SDK / 'Microsoft.Web.WebView2.Core.dll'}",
        f"/reference:{SDK / 'Microsoft.Web.WebView2.WinForms.dll'}",
        f"/resource:{ROOT / 'reader.js'},reader.js",
        f"/out:{OUTPUT / 'SDU-Study.exe'}", str(ROOT / "App.cs"),
    ], check=True)
    shutil.copy2(ROOT / "README.md", OUTPUT / "使用说明.txt")
    (OUTPUT / "THIRD-PARTY.txt").write_text(
        f"Microsoft.Web.WebView2 SDK {VERSION}\n{URL}\n"
        "License: LICENSE-WebView2.txt\nWindows .NET Framework and WebView2 Runtime are provided by Microsoft.\n",
        encoding="utf-8",
    )
    archive = ROOT / "dist" / "SDU-Accessible-Study-win-x64.zip"
    temporary = archive.with_suffix(".zip.tmp")
    try:
        with zipfile.ZipFile(temporary, "w", zipfile.ZIP_DEFLATED) as z:
            for name in PACKAGE_FILES:
                z.write(OUTPUT / name, f"{OUTPUT.name}/{name}")
        with zipfile.ZipFile(temporary) as z:
            if z.testzip() is not None or set(z.namelist()) != {f"{OUTPUT.name}/{name}" for name in PACKAGE_FILES}:
                raise RuntimeError("Package validation failed; previous ZIP was kept.")
        temporary.replace(archive)
    finally:
        temporary.unlink(missing_ok=True)
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    archive.with_suffix(".zip.sha256").write_text(f"{digest}  {archive.name}\n", encoding="ascii")
    print(f"Package: {archive}\nBytes: {archive.stat().st_size}\nSHA256: {digest}")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError, zipfile.BadZipFile, KeyError, ET.ParseError, subprocess.CalledProcessError) as error:
        raise SystemExit(f"Build failed: {error}") from error
