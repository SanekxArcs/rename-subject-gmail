$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$iconsDirectory = Join-Path $PSScriptRoot '..\icons'

function New-RoundedPath([single]$left, [single]$top, [single]$width, [single]$height, [single]$radius) {
    $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $diameter = $radius * 2
    $path.AddArc($left, $top, $diameter, $diameter, 180, 90)
    $path.AddArc($left + $width - $diameter, $top, $diameter, $diameter, 270, 90)
    $path.AddArc($left + $width - $diameter, $top + $height - $diameter, $diameter, $diameter, 0, 90)
    $path.AddArc($left, $top + $height - $diameter, $diameter, $diameter, 90, 90)
    $path.CloseFigure()
    return ,$path
}

foreach ($size in @(16, 32, 48, 128)) {
    $canvas = [System.Drawing.Bitmap]::new(512, 512)
    $graphics = [System.Drawing.Graphics]::FromImage($canvas)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.ScaleTransform(4, 4)
    $dark = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#18181b'))
    $light = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#fafafa'))
    $outline = [System.Drawing.Pen]::new($light, 6)
    $outline.StartCap = $outline.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $background = New-RoundedPath 4 4 120 120 28
    $envelope = New-RoundedPath 25 35 78 58 8
    $graphics.FillPath($dark, $background)
    $graphics.DrawPath($outline, $envelope)
    $graphics.DrawLines($outline, [System.Drawing.PointF[]]@([System.Drawing.PointF]::new(28, 40), [System.Drawing.PointF]::new(64, 67), [System.Drawing.PointF]::new(100, 40)))
    $pencil = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $pencil.AddPolygon([System.Drawing.PointF[]]@([System.Drawing.PointF]::new(94, 64), [System.Drawing.PointF]::new(110, 80), [System.Drawing.PointF]::new(81, 109), [System.Drawing.PointF]::new(60, 114), [System.Drawing.PointF]::new(65, 93)))
    $cutout = [System.Drawing.Pen]::new($dark, 10)
    $cutout.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    $graphics.DrawPath($cutout, $pencil)
    $graphics.FillPath($light, $pencil)
    $detail = [System.Drawing.Pen]::new($dark, 4)
    $graphics.DrawLine($detail, 89, 70, 104, 85)
    $graphics.DrawLine($detail, 65, 94, 80, 109)
    $output = [System.Drawing.Bitmap]::new($size, $size)
    $resizer = [System.Drawing.Graphics]::FromImage($output)
    $resizer.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $resizer.DrawImage($canvas, 0, 0, $size, $size)
    $output.Save((Join-Path $iconsDirectory "icon$size.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    foreach ($resource in @($resizer, $output, $detail, $cutout, $pencil, $envelope, $background, $outline, $light, $dark, $graphics, $canvas)) { $resource.Dispose() }
    Write-Output "Generated icon$size.png"
}
