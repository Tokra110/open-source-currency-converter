
Add-Type -AssemblyName System.Drawing

function Resize-Image {
    param(
        [string]$SourcePath,
        [string]$DestinationPath,
        [int]$Width,
        [int]$Height
    )

    $srcImage = [System.Drawing.Image]::FromFile($SourcePath)
    $destBitmap = New-Object System.Drawing.Bitmap($Width, $Height)
    $graphics = [System.Drawing.Graphics]::FromImage($destBitmap)

    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality

    # Clear to transparent in case of non-square images (though icons should be square)
    $graphics.Clear([System.Drawing.Color]::Transparent)

    $graphics.DrawImage($srcImage, 0, 0, $Width, $Height)
    
    $destBitmap.Save($DestinationPath, [System.Drawing.Imaging.ImageFormat]::Png)
    
    $graphics.Dispose()
    $destBitmap.Dispose()
    $srcImage.Dispose()
    
    Write-Host "Created $DestinationPath"
}

$source = "c:\Users\kerit\Documents\Programming\Scratch-pad\chrome-currency-converter\docs\large-icon.png"
$iconsDir = "c:\Users\kerit\Documents\Programming\Scratch-pad\chrome-currency-converter\icons"

Resize-Image -SourcePath $source -DestinationPath "$iconsDir\icon16.png" -Width 16 -Height 16
Resize-Image -SourcePath $source -DestinationPath "$iconsDir\icon48.png" -Width 48 -Height 48
Resize-Image -SourcePath $source -DestinationPath "$iconsDir\icon128.png" -Width 128 -Height 128
