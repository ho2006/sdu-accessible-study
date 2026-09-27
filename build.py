"""Build the Windows x64 portable app using the Windows .NET Framework compiler."""
from pathlib import Path
import hashlib
import shutil
import subprocess
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parent
BUILD = ROOT / "build"
SDK = BUILD / "sdk"
OUTPUT = ROOT / "dist" / "SDU-Accessible-Study"
VERSION = "1.0.4191.47"
URL = f"https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/{VERSION}/microsoft.web.webview2.{VERSION}.nupkg"


def main():
    SDK.mkdir(parents=True, exist_ok=True)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    package = BUILD / "webview2.nupkg"
    if not package.exists():
        urllib.request.urlretrieve(URL, package)
    with zipfile.ZipFile(package) as archive:
        for name in ("Microsoft.Web.WebView2.Core", "Microsoft.Web.WebView2.WinForms"):
            (SDK / f"{name}.dll").write_bytes(archive.read(f"lib/net462/{name}.dll"))
        (SDK / "WebView2Loader.dll").write_bytes(archive.read("runtimes/win-x64/native/WebView2Loader.dll"))
        (SDK / "LICENSE-WebView2.txt").write_bytes(archive.read("LICENSE.txt"))
    for file in SDK.iterdir():
        if file.is_file():
            shutil.copy2(file, OUTPUT / file.name)
    compiler = Path(r"C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe")
    subprocess.run([
        str(compiler), "/nologo", "/target:winexe", "/platform:x64", "/optimize+", "/codepage:65001",
        "/reference:System.Windows.Forms.dll", "/reference:System.Drawing.dll",
        "/reference:System.Web.Extensions.dll",
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
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as z:
        for file in OUTPUT.iterdir():
            if file.is_file():
                z.write(file, f"{OUTPUT.name}/{file.name}")
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    archive.with_suffix(".zip.sha256").write_text(f"{digest}  {archive.name}\n", encoding="ascii")
    print(f"Package: {archive}\nBytes: {archive.stat().st_size}\nSHA256: {digest}")


if __name__ == "__main__":
    main()
