$signupBody = @{email='testfb6@easymod.com';username='testfb6';password='Test@1234567';name='Test FB User 6'} | ConvertTo-Json
Write-Host "1. Creating user..." -ForegroundColor Green
try {
    $signupResp = Invoke-WebRequest -Uri 'http://localhost:3000/auth/signup' -Method POST -Body $signupBody -ContentType 'application/json' -ErrorAction Stop
    $signupData = $signupResp.Content | ConvertFrom-Json
    $shopId = $signupData.data.shop.id
    Write-Host "OK User created. Shop ID: $shopId"
} catch {
    Write-Host "FAIL Signup failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

$signinBody = @{email='testfb6@easymod.com';password='Test@1234567'} | ConvertTo-Json
Write-Host "2. Logging in..." -ForegroundColor Green
try {
    $signinResp = Invoke-WebRequest -Uri 'http://localhost:3000/auth/signin' -Method POST -Body $signinBody -ContentType 'application/json' -ErrorAction Stop
    $signinData = $signinResp.Content | ConvertFrom-Json
    $token = $signinData.data.accessToken
    Write-Host "OK Logged in. Token: $($token.substring(0,30))..."
} catch {
    Write-Host "FAIL Signin failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

$connectBody = @{platform='facebook';asset_id='123456789';display_name='Test Facebook Page';access_token='test_token_12345'} | ConvertTo-Json
Write-Host "3. Testing Manual Connect endpoint..." -ForegroundColor Green
try {
    $headers = @{'Authorization'="Bearer $token"; 'X-Shop-Id'="$shopId"}
    $connectResp = Invoke-WebRequest -Uri 'http://localhost:3000/integrations/meta/manual-connect' -Method POST -Body $connectBody -ContentType 'application/json' -Headers $headers -ErrorAction Stop
    Write-Host "OK SUCCESS - Status: $($connectResp.StatusCode)" -ForegroundColor Green
    Write-Host "Response:" -ForegroundColor Yellow
    $connectResp.Content | ConvertFrom-Json | ConvertTo-Json -Depth 3
} catch {
    Write-Host "FAIL Status: $($_.Exception.Response.StatusCode)" -ForegroundColor Red
    try {
        Write-Host "Error Response:" -ForegroundColor Yellow
        $errBody = $_.Exception.Response.Content.ReadAsStringAsync().Result
        $errBody | ConvertFrom-Json | ConvertTo-Json
    } catch {
        Write-Host "Raw: $errBody"
    }
}
