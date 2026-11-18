param([long]$WindowHandle, [switch]$DoubleClick)
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class FloralNativeInput {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint data, UIntPtr extra);
}
'@
$hwnd = [IntPtr]$WindowHandle
[FloralNativeInput]::SetProcessDPIAware() | Out-Null
$old = New-Object FloralNativeInput+POINT
$rect = New-Object FloralNativeInput+RECT
[FloralNativeInput]::GetCursorPos([ref]$old) | Out-Null
[FloralNativeInput]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
[FloralNativeInput]::SetForegroundWindow($hwnd) | Out-Null
try {
  $x = $rect.Left + 80
  $y = $rect.Top + 80
  [FloralNativeInput]::SetCursorPos($x, $y) | Out-Null
  Start-Sleep -Milliseconds 100
  if ($DoubleClick) {
    for ($i = 0; $i -lt 2; $i++) {
      [FloralNativeInput]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
      Start-Sleep -Milliseconds 40
      [FloralNativeInput]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
      Start-Sleep -Milliseconds 80
    }
    exit
  }
  [FloralNativeInput]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 100
  for ($i = 1; $i -le 12; $i++) {
    [FloralNativeInput]::SetCursorPos(($x + $i * 6), ($y + $i * 2)) | Out-Null
    Start-Sleep -Milliseconds 25
  }
} finally {
  [FloralNativeInput]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 100
  [FloralNativeInput]::SetCursorPos($old.X, $old.Y) | Out-Null
}
