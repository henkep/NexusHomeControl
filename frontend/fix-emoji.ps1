# Fix emoji encoding in index.html
$file = "index.html"
$content = Get-Content -Path $file -Raw -Encoding UTF8

# Replace scene icons with HTML entities
$content = $content -replace '<div class="scene-icon">[^<]+</div><div class="scene-name">Morning', '<div class="scene-icon">&#x1F305;</div><div class="scene-name">Morning'
$content = $content -replace '<div class="scene-icon">[^<]+</div><div class="scene-name">Evening', '<div class="scene-icon">&#x1F319;</div><div class="scene-name">Evening'
$content = $content -replace '<div class="scene-icon">[^<]+</div><div class="scene-name">Movie', '<div class="scene-icon">&#x1F3AC;</div><div class="scene-name">Movie'
$content = $content -replace '<div class="scene-icon">[^<]+</div><div class="scene-name">Away', '<div class="scene-icon">&#x1F3E0;</div><div class="scene-name">Away'

# Save with UTF8 encoding
[System.IO.File]::WriteAllText($file, $content, [System.Text.Encoding]::UTF8)
Write-Host "Emoji fix applied!" -ForegroundColor Green
