# Windows VPS deployment

The deployed public backend URL is `https://157.85.96.139:5444`. Apache terminates TLS on port 5444 and proxies only `/api/` to the Node process on `127.0.0.1:8787`.

`WebAiTyphoonProxy` is a Task Scheduler process manager. It starts at boot and its runner restarts Node five seconds after an unexpected exit. Its environment file is `C:\ProgramData\WebAi\typhoon-proxy.env`; it is ACL-restricted to `SYSTEM` and `Administrators` and must never be committed or copied into browser files.

After a backend source update, deploy the single proxy source and restart the task:

```powershell
Copy-Item .\server\index.mjs C:\WebAi\server\index.mjs -Force
Stop-ScheduledTask -TaskName WebAiTyphoonProxy
Start-ScheduledTask -TaskName WebAiTyphoonProxy
```

Check the service and health endpoint without printing environment values:

```powershell
Get-ScheduledTask -TaskName WebAiTyphoonProxy
Invoke-WebRequest https://157.85.96.139:5444/api/health
```

Apache configuration is in `C:\xampp\apache\conf\extra\webai-typhoon-proxy-5444.conf`. Validate it before a restart with `C:\xampp\apache\bin\httpd.exe -t`.
