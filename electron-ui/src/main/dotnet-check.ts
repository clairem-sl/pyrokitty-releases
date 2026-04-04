import { execFile, spawn } from 'child_process';
import { dialog } from 'electron';

/** Check if any .NET runtime is installed. Returns true if found. */
function hasDotnetRuntime(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('dotnet', ['--list-runtimes'], { timeout: 10_000 }, (err, stdout) => {
      if (err) return resolve(false);
      resolve(stdout.includes('Microsoft.NETCore.App'));
    });
  });
}

/** Run Microsoft's official dotnet-install script directly (no temp files). */
function runInstallScript(): Promise<number | null> {
  return new Promise((resolve, reject) => {
    let child;
    if (process.platform === 'win32') {
      child = spawn('powershell', [
        '-NoProfile', '-ExecutionPolicy', 'Bypass',
        '-Command',
        `&([scriptblock]::Create((Invoke-WebRequest -UseBasicParsing 'https://dot.net/v1/dotnet-install.ps1'))) -Runtime dotnet -Channel STS`,
      ], { stdio: 'pipe' });
    } else {
      child = spawn('bash', [
        '-c',
        `curl -sSL https://dot.net/v1/dotnet-install.sh | bash /dev/stdin --runtime dotnet --channel STS`,
      ], { stdio: 'pipe' });
    }

    let output = '';
    child.stdout?.on('data', (d) => { output += d.toString(); });
    child.stderr?.on('data', (d) => { output += d.toString(); });
    child.on('error', reject);
    child.on('exit', (code) => {
      console.log(`[DotNet] Install script output:\n${output}`);
      resolve(code);
    });
  });
}

/**
 * Check for .NET runtime at startup. If missing, prompt the user and
 * install it using Microsoft's official dotnet-install script.
 */
export async function ensureDotnet(): Promise<void> {
  if (await hasDotnetRuntime()) return;

  console.warn('[DotNet] No .NET runtime detected — prompting user to install');

  const { response } = await dialog.showMessageBox({
    type: 'warning',
    title: '.NET Runtime Required',
    message: 'PyroKitty requires the .NET runtime for voice chat and the 3D viewer.\n\nWould you like to install it now?',
    buttons: ['Install', 'Skip'],
    defaultId: 0,
    cancelId: 1,
  });

  if (response !== 0) {
    console.warn('[DotNet] User skipped .NET installation');
    return;
  }

  try {
    console.log('[DotNet] Running install script...');
    const exitCode = await runInstallScript();
    console.log(`[DotNet] Install script exited with code ${exitCode}`);

    if (exitCode === 0) {
      dialog.showMessageBoxSync({
        type: 'info',
        title: '.NET Installed',
        message: '.NET runtime was installed successfully.',
      });
    } else {
      dialog.showMessageBoxSync({
        type: 'error',
        title: 'Installation Failed',
        message: `.NET install script exited with code ${exitCode}. Voice chat and the 3D viewer may not work.\n\nYou can install .NET manually from https://dotnet.microsoft.com/download`,
      });
    }
  } catch (err: any) {
    console.error('[DotNet] Installation failed:', err);
    dialog.showMessageBoxSync({
      type: 'error',
      title: 'Installation Failed',
      message: `Failed to install .NET: ${err.message}\n\nYou can install .NET manually from https://dotnet.microsoft.com/download`,
    });
  }
}
