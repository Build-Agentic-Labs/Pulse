# Excel Gantt Add-in

This folder contains the local sideload manifest for running the M-Tools Gantt UI inside Excel as a content add-in.

## Local test

1. Start the app with HTTPS:

   ```bash
   npm run dev:excel
   ```

   The `dev:excel` script expects these local cert files:

   ```text
   certificates/localhost.pem
   certificates/localhost-key.pem
   ```

   They were generated for local testing with:

   ```bash
   openssl req -x509 -newkey rsa:2048 -nodes -keyout certificates/localhost-key.pem -out certificates/localhost.pem -days 365 -subj /CN=localhost -addext subjectAltName=DNS:localhost,IP:127.0.0.1
   ```

2. Open Excel.
3. Sideload `office/excel-gantt-manifest.xml`.
4. Insert the `M-Tools Gantt` add-in into a worksheet.
5. Resize the embedded object to give the Gantt workspace enough room.

The manifest points to:

```text
https://localhost:3000/excel/gantt
```

If Excel refuses to load the local page, the local HTTPS certificate needs to be trusted for Office. For production, replace the `https://localhost:3000` URLs in the manifest with the hosted HTTPS app URL.
