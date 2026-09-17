Add-Type -AssemblyName System.Drawing

$assetsDir = "E:\unversal downloader\assets"
if (-not (Test-Path $assetsDir)) {
    New-Item -ItemType Directory -Path $assetsDir -Force | Out-Null
}

$pngPath = Join-Path $assetsDir "icon.png"
$icoPath = Join-Path $assetsDir "icon.ico"

$size = 256
$bitmap = New-Object System.Drawing.Bitmap $size, $size
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

# Background transparent
$graphics.Clear([System.Drawing.Color]::Transparent)

# Rounded Rectangle background with gradient
$rect = New-Object System.Drawing.Rectangle 12, 12, ($size - 24), ($size - 24)
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$radius = 48
$d = $radius * 2

$path.AddArc($rect.X, $rect.Y, $d, $d, 180, 90)
$path.AddArc($rect.X + $rect.Width - $d, $rect.Y, $d, $d, 270, 90)
$path.AddArc($rect.X + $rect.Width - $d, $rect.Y + $rect.Height - $d, $d, $d, 0, 90)
$path.AddArc($rect.X, $rect.Y + $rect.Height - $d, $d, $d, 90, 90)
$path.CloseFigure()

$color1 = [System.Drawing.Color]::FromArgb(255, 99, 102, 241) # Indigo
$color2 = [System.Drawing.Color]::FromArgb(255, 139, 92, 246) # Violet
$color3 = [System.Drawing.Color]::FromArgb(255, 236, 72, 153) # Pink
$gradientBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush (New-Object System.Drawing.Point 12, 12), (New-Object System.Drawing.Point ($size - 12), ($size - 12)), $color1, $color3

$graphics.FillPath($gradientBrush, $path)

# Draw subtle inner glow/border
$pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(100, 255, 255, 255)), 2
$graphics.DrawPath($pen, $path)

# Draw white download icon
$whiteBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
$whitePen = New-Object System.Drawing.Pen ([System.Drawing.Color]::White), 14
$whitePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$whitePen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$whitePen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

$cx = $size / 2
$cy = $size / 2

# Vertical arrow stem
$graphics.DrawLine($whitePen, [float]$cx, [float]($cy - 48), [float]$cx, [float]($cy + 22))

# Arrow head points
$arrowHead = New-Object System.Drawing.Drawing2D.GraphicsPath
$arrowHead.AddLine([float]($cx - 36), [float]($cy - 12), [float]$cx, [float]($cy + 26))
$arrowHead.AddLine([float]$cx, [float]($cy + 26), [float]($cx + 36), [float]($cy - 12))
$graphics.DrawPath($whitePen, $arrowHead)

# Bottom tray line
$trayPath = New-Object System.Drawing.Drawing2D.GraphicsPath
$trayPath.AddLine([float]($cx - 52), [float]($cy + 42), [float]($cx - 52), [float]($cy + 58))
$trayPath.AddLine([float]($cx - 52), [float]($cy + 58), [float]($cx + 52), [float]($cy + 58))
$trayPath.AddLine([float]($cx + 52), [float]($cy + 58), [float]($cx + 52), [float]($cy + 42))
$graphics.DrawPath($whitePen, $trayPath)

# Save PNG
$bitmap.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
Write-Host "Saved PNG icon: $pngPath"

# Save ICO
$hIcon = $bitmap.GetHicon()
$icon = [System.Drawing.Icon]::FromHandle($hIcon)
$fileStream = New-Object System.IO.FileStream $icoPath, ([System.IO.FileMode]::Create)
$icon.Save($fileStream)
$fileStream.Close()
$icon.Dispose()

$graphics.Dispose()
$bitmap.Dispose()

Write-Host "Saved ICO icon: $icoPath"
