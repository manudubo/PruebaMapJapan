<#macro emailLayout>
<html lang="${locale.language}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f5f5f7;font-family:Inter,-apple-system,'Helvetica Neue',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f7;padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
        <tr><td style="padding-bottom:8px;">
          <span style="font-size:18px;font-weight:600;color:#1d1d1f;letter-spacing:-0.01em;">TravelMap</span>
        </td></tr>
        <tr><td style="border-top:1px solid #d0d0d5;padding-bottom:24px;"></td></tr>
        <tr><td style="background:#ffffff;border:1px solid rgba(0,0,0,0.1);border-radius:0;padding:32px;">
          <#nested>
        </td></tr>
        <tr><td style="padding-top:24px;font-size:12px;color:#86868b;text-align:center;">
          TravelMap — this is an automated message
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
</#macro>
