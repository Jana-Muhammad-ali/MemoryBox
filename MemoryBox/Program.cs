using System.Globalization;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Microsoft.Extensions.Options;
using MemoryBox.Data;
using MemoryBox.Models;
using MemoryBox.Services;

var builder = WebApplication.CreateBuilder(args);

// ---- Database (SQLite — a single file, nothing to install) ----
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseSqlite(builder.Configuration.GetConnectionString("Default")
        ?? "Data Source=memorybox.db"));

// ---- Identity (password hashing, user storage, etc.) ----
builder.Services.AddIdentityCore<ApplicationUser>(options =>
{
    options.Password.RequireNonAlphanumeric = false; // keep it simple for now
    options.Password.RequiredLength = 8;
    options.User.RequireUniqueEmail = true;
})
.AddEntityFrameworkStores<AppDbContext>();

// ---- JWT auth ----
var jwtKey = builder.Configuration["Jwt:Key"] ?? "CHANGE_THIS_TO_A_LONG_RANDOM_SECRET_KEY_1234567890";
var jwtIssuer = builder.Configuration["Jwt:Issuer"] ?? "MemoryBox";

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        // Without this, ASP.NET Core silently remaps standard JWT claim names
        // (e.g. "sub" -> ClaimTypes.NameIdentifier) when reading the token,
        // which breaks every FindFirstValue(JwtRegisteredClaimNames.Sub) lookup below.
        options.MapInboundClaims = false;
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = false,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = jwtIssuer,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey))
        };

        // TEMPORARY DIAGNOSTIC LOGGING — prints the real reason a token gets
        // rejected (bad signature, expired, wrong issuer, etc.) to the console.
        // Remove this block once the 401 issue is solved.
        options.Events = new JwtBearerEvents
        {
            OnAuthenticationFailed = context =>
            {
                Console.WriteLine("[JWT] Authentication FAILED: " + context.Exception.GetType().Name + " - " + context.Exception.Message);
                return Task.CompletedTask;
            },
            OnChallenge = context =>
            {
                Console.WriteLine("[JWT] Challenge issued. Error: " + context.Error + " | ErrorDescription: " + context.ErrorDescription);
                return Task.CompletedTask;
            },
            OnTokenValidated = context =>
            {
                var subClaim = context.Principal?.FindFirst("sub")?.Value
                    ?? context.Principal?.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
                Console.WriteLine("[JWT] Token validated OK. sub/nameidentifier claim value = " + (subClaim ?? "<< NULL — this is the bug >>"));
                return Task.CompletedTask;
            }
        };
    });
builder.Services.AddAuthorization();

// ---- Email (Gmail SMTP) + the background worker that sends unlock emails ----
builder.Services.Configure<EmailSettings>(builder.Configuration.GetSection("Email"));
builder.Services.Configure<AppSettings>(builder.Configuration.GetSection("App"));
builder.Services.AddSingleton<IEmailSender, SmtpEmailSender>();
builder.Services.AddHostedService<CapsuleUnlockBackgroundService>();

// ---- Upload size limits ----
// Kestrel's default MaxRequestBodySize is ~30MB and the default multipart form
// limit is 128MB. A few minutes of phone video blows past either one, so a video
// upload was getting cut off by the server *before* our own 25MB-per-file check
// ever ran, which is why it just failed instead of showing a real error message.
// Raise both limits so the request actually makes it to our code below, where we
// enforce a sensible per-file limit ourselves (see MaxBytesFor).
const long maxUploadRequestBytes = 320L * 1024 * 1024; // 320 MB, with headroom over the 300MB video cap below

builder.WebHost.ConfigureKestrel(options =>
{
    options.Limits.MaxRequestBodySize = maxUploadRequestBytes;
});
builder.Services.Configure<FormOptions>(options =>
{
    options.MultipartBodyLengthLimit = maxUploadRequestBytes;
});

var app = builder.Build();

// ---- Startup sanity check: is email actually configured? ----
// Without this check, a missing SenderEmail/SenderAppPassword only shows up as a
// LogWarning buried inside a console that's also printing every SQL query — easy to
// miss entirely. The background service then just retries and fails forever, silently,
// and capsules never send their unlock email even though everything else "works".
// Print something impossible to miss instead, once, right when the app starts.
using (var startupScope = app.Services.CreateScope())
{
    var emailSettings = startupScope.ServiceProvider.GetRequiredService<IOptions<EmailSettings>>().Value;
    if (string.IsNullOrWhiteSpace(emailSettings.SenderEmail) || string.IsNullOrWhiteSpace(emailSettings.SenderAppPassword))
    {
        Console.ForegroundColor = ConsoleColor.Red;
        Console.WriteLine();
        Console.WriteLine("=====================================================================");
        Console.WriteLine(" EMAIL IS NOT CONFIGURED (Email:SenderEmail / Email:SenderAppPassword)");
        Console.WriteLine(" Capsules WILL unlock in the database, but NO unlock email will ever");
        Console.WriteLine(" be sent until appsettings.json -> \"Email\" is filled in.");
        Console.WriteLine(" Get a 16-char Gmail App Password: https://myaccount.google.com/apppasswords");
        Console.WriteLine("=====================================================================");
        Console.WriteLine();
        Console.ResetColor();
    }
    else
    {
        Console.WriteLine($"[Email] Configured to send as {emailSettings.SenderEmail} via {emailSettings.SmtpHost}:{emailSettings.SmtpPort}");
    }
}

// ---- Serve the frontend (wwwroot/index.html, style.css, script.js) ----
app.UseDefaultFiles();   // so "/" serves index.html automatically
app.UseStaticFiles();

app.UseAuthentication();
app.UseAuthorization();

// ==========================================================
// AUTH ENDPOINTS
// ==========================================================
var auth = app.MapGroup("/api/auth");

auth.MapPost("/register", async (RegisterRequest req, UserManager<ApplicationUser> userManager) =>
{
    var user = new ApplicationUser
    {
        UserName = req.Email,
        Email = req.Email,
        FullName = req.FullName
    };

    var result = await userManager.CreateAsync(user, req.Password);
    if (!result.Succeeded)
    {
        var errors = result.Errors.ToDictionary(e => e.Code, e => new[] { e.Description });
        return Results.ValidationProblem(errors);
    }

    return Results.Ok();
});

auth.MapPost("/login", async (LoginRequest req, UserManager<ApplicationUser> userManager) =>
{
    var user = await userManager.FindByEmailAsync(req.Email);
    if (user is null || !await userManager.CheckPasswordAsync(user, req.Password))
    {
        return Results.Unauthorized();
    }

    var claims = new[]
    {
        new Claim(JwtRegisteredClaimNames.Sub, user.Id),
        new Claim(JwtRegisteredClaimNames.Email, user.Email ?? ""),
        new Claim("fullName", user.FullName ?? "")
    };

    var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey));
    var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);
    var expires = DateTime.UtcNow.AddDays(7);

    var token = new JwtSecurityToken(
        issuer: jwtIssuer,
        claims: claims,
        expires: expires,
        signingCredentials: creds);

    return Results.Ok(new
    {
        accessToken = new JwtSecurityTokenHandler().WriteToken(token),
        expiresAt = expires,
        fullName = user.FullName,
        email = user.Email
    });
});

// A quick protected test endpoint — proves the token works end to end.
// Try it from the browser console after logging in:
//   fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + localStorage.getItem('mb_token') } }).then(r => r.json()).then(console.log)
auth.MapGet("/me", (ClaimsPrincipal user) =>
{
    return Results.Ok(new
    {
        id = user.FindFirstValue(JwtRegisteredClaimNames.Sub),
        email = user.FindFirstValue(JwtRegisteredClaimNames.Email),
        fullName = user.FindFirstValue("fullName")
    });
}).RequireAuthorization();

// ==========================================================
// CAPSULE ENDPOINTS — creating and listing sealed memory capsules.
// Every endpoint here requires a valid Bearer token (RequireAuthorization()),
// so nobody can create or read a capsule without being logged in.
// ==========================================================
var capsules = app.MapGroup("/api/capsules").RequireAuthorization();

capsules.MapPost("/", async (HttpRequest request, AppDbContext db, UserManager<ApplicationUser> userManager,
    ClaimsPrincipal user, IWebHostEnvironment env) =>
{
    var userId = user.FindFirstValue(JwtRegisteredClaimNames.Sub);
    if (userId is null) return Results.Unauthorized();

    var appUser = await userManager.FindByIdAsync(userId);
    if (appUser is null) return Results.Unauthorized();

    if (!request.HasFormContentType) return Results.BadRequest(new { error = "Expected multipart/form-data." });
    var form = await request.ReadFormAsync();

    var type = form["type"].ToString();
    if (type is not ("message" or "photo" or "voice" or "video" or "moments"))
        return Results.BadRequest(new { error = "Invalid capsule type." });

    var messageText = form["messageText"].ToString();
    var recipientType = form["recipientType"].ToString() == "other" ? "other" : "me";
    var recipientName = form["recipientName"].ToString();
    var recipientEmailInput = form["recipientEmail"].ToString();

    // resolve who actually receives the email
    string recipientEmail;
    if (recipientType == "other")
    {
        if (string.IsNullOrWhiteSpace(recipientEmailInput))
            return Results.BadRequest(new { error = "Recipient email is required." });
        recipientEmail = recipientEmailInput.Trim();
    }
    else
    {
        recipientEmail = appUser.Email ?? "";
        recipientName = appUser.FullName;
    }

    if (type == "message" && string.IsNullOrWhiteSpace(messageText))
        return Results.BadRequest(new { error = "Message text is required." });

    var unlockAtRaw = form["unlockAtUtc"].ToString();
    // NOTE: RoundtripKind and AdjustToUniversal cannot be combined — .NET throws
    // ArgumentException every time. The client sends an ISO string ending in "Z",
    // so AdjustToUniversal alone correctly interprets it as UTC.
    if (!DateTime.TryParse(unlockAtRaw, CultureInfo.InvariantCulture,
            DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var unlockAtUtc))
        return Results.BadRequest(new { error = "Invalid unlock date/time." });

    if (unlockAtUtc <= DateTime.UtcNow)
        return Results.BadRequest(new { error = "The unlock time must be in the future." });

    var capsule = new Capsule
    {
        UserId = userId,
        Type = type,
        MessageText = string.IsNullOrWhiteSpace(messageText) ? null : messageText.Trim(),
        RecipientType = recipientType,
        RecipientName = string.IsNullOrWhiteSpace(recipientName) ? null : recipientName.Trim(),
        RecipientEmail = recipientEmail,
        UnlockAtUtc = unlockAtUtc,
        ViewToken = Convert.ToHexString(RandomNumberGenerator.GetBytes(24)) // 48 random hex chars — effectively unguessable
    };

    db.Capsules.Add(capsule);
    await db.SaveChangesAsync(); // saved first so we have an Id to build the upload folder name

    // ---- optional media files (photo / voice / video) ----
    if (form.Files.Count > 0)
    {
        var webRoot = string.IsNullOrEmpty(env.WebRootPath)
            ? Path.Combine(env.ContentRootPath, "wwwroot")
            : env.WebRootPath;
        var uploadsDir = Path.Combine(webRoot, "uploads", userId, capsule.Id.ToString());
        Directory.CreateDirectory(uploadsDir);

        var savedPaths = new List<string>();
        foreach (var file in form.Files)
        {
            if (file.Length == 0) continue;
            var limit = MaxBytesFor(file.ContentType);
            if (file.Length > limit)
                return Results.BadRequest(new { error = $"'{file.FileName}' is larger than the {limit / 1024 / 1024}MB limit for this file type." });

            var safeName = $"{Guid.NewGuid():N}{Path.GetExtension(file.FileName)}";
            var fullPath = Path.Combine(uploadsDir, safeName);
            await using (var stream = File.Create(fullPath))
            {
                await file.CopyToAsync(stream);
            }
            savedPaths.Add($"/uploads/{userId}/{capsule.Id}/{safeName}");
        }

        if (savedPaths.Count > 0)
        {
            capsule.MediaPaths = string.Join(",", savedPaths);
            await db.SaveChangesAsync();
        }
    }

    return Results.Ok(new
    {
        capsule.Id,
        capsule.Type,
        unlockAtUtc = capsule.UnlockAtUtc
    });
});

capsules.MapGet("/", async (AppDbContext db, ClaimsPrincipal user) =>
{
    var userId = user.FindFirstValue(JwtRegisteredClaimNames.Sub);
    if (userId is null) return Results.Unauthorized();

    var list = await db.Capsules
        .Where(c => c.UserId == userId)
        .OrderByDescending(c => c.CreatedAtUtc)
        .Select(c => new
        {
            c.Id,
            c.Type,
            c.MessageText,
            mediaPaths = string.IsNullOrEmpty(c.MediaPaths) ? Array.Empty<string>() : c.MediaPaths.Split(',', StringSplitOptions.RemoveEmptyEntries),
            c.RecipientType,
            c.RecipientName,
            c.RecipientEmail,
            unlockAtUtc = c.UnlockAtUtc,
            createdAtUtc = c.CreatedAtUtc,
            c.IsSent
        })
        .ToListAsync();

    return Results.Ok(list);
});

// ---- Add moments to an existing capsule over time (only before it unlocks) ----
// This is what powers the "moments" capsule type: keep coming back and dropping in
// photos/videos, and everything you added gets bundled into one email once the
// unlock date arrives.
capsules.MapPost("/{id:int}/moments", async (int id, HttpRequest request, AppDbContext db,
    ClaimsPrincipal user, IWebHostEnvironment env) =>
{
    var userId = user.FindFirstValue(JwtRegisteredClaimNames.Sub);
    if (userId is null) return Results.Unauthorized();

    var capsule = await db.Capsules.FirstOrDefaultAsync(c => c.Id == id && c.UserId == userId);
    if (capsule is null) return Results.NotFound(new { error = "Capsule not found." });

    if (capsule.IsSent || capsule.UnlockAtUtc <= DateTime.UtcNow)
        return Results.BadRequest(new { error = "This capsule has already unlocked — you can't add more moments to it." });

    if (!request.HasFormContentType) return Results.BadRequest(new { error = "Expected multipart/form-data." });
    var form = await request.ReadFormAsync();
    if (form.Files.Count == 0) return Results.BadRequest(new { error = "No files were uploaded." });

    var webRoot = string.IsNullOrEmpty(env.WebRootPath)
        ? Path.Combine(env.ContentRootPath, "wwwroot")
        : env.WebRootPath;
    var uploadsDir = Path.Combine(webRoot, "uploads", userId, capsule.Id.ToString());
    Directory.CreateDirectory(uploadsDir);

    var existingPaths = string.IsNullOrEmpty(capsule.MediaPaths)
        ? new List<string>()
        : capsule.MediaPaths.Split(',', StringSplitOptions.RemoveEmptyEntries).ToList();

    foreach (var file in form.Files)
    {
        if (file.Length == 0) continue;
        var limit = MaxBytesFor(file.ContentType);
        if (file.Length > limit)
            return Results.BadRequest(new { error = $"'{file.FileName}' is larger than the {limit / 1024 / 1024}MB limit for this file type." });

        var safeName = $"{Guid.NewGuid():N}{Path.GetExtension(file.FileName)}";
        var fullPath = Path.Combine(uploadsDir, safeName);
        await using (var stream = File.Create(fullPath))
        {
            await file.CopyToAsync(stream);
        }
        existingPaths.Add($"/uploads/{userId}/{capsule.Id}/{safeName}");
    }

    capsule.MediaPaths = string.Join(",", existingPaths);
    await db.SaveChangesAsync();

    return Results.Ok(new { capsule.Id, momentsCount = existingPaths.Count });
});

// ---- Public, token-scoped capsule view (the link sent in the unlock email) ----
// No login required — but the token only ever resolves to the ONE capsule it belongs
// to, nothing else about the account or its other capsules is exposed here, and the
// content stays hidden until UnlockAtUtc actually passes even if someone has the link early.
capsules.MapGet("/view/{token}", async (string token, AppDbContext db) =>
{
    if (string.IsNullOrWhiteSpace(token)) return Results.NotFound(new { error = "This capsule link is invalid." });

    var capsule = await db.Capsules.FirstOrDefaultAsync(c => c.ViewToken == token);
    if (capsule is null) return Results.NotFound(new { error = "This capsule link is invalid." });

    if (capsule.UnlockAtUtc > DateTime.UtcNow)
    {
        return Results.Json(new { locked = true, unlockAtUtc = capsule.UnlockAtUtc }, statusCode: StatusCodes.Status423Locked);
    }

    return Results.Ok(new
    {
        capsule.Type,
        capsule.MessageText,
        mediaPaths = string.IsNullOrEmpty(capsule.MediaPaths) ? Array.Empty<string>() : capsule.MediaPaths.Split(',', StringSplitOptions.RemoveEmptyEntries),
        capsule.RecipientName,
        unlockAtUtc = capsule.UnlockAtUtc,
        createdAtUtc = capsule.CreatedAtUtc
    });
}).AllowAnonymous();

app.MapFallbackToFile("index.html"); // SPA-style fallback

app.Run();

// Photos and voice notes are small; a few minutes of phone video is not.
// Give video files their own, much larger ceiling instead of one flat limit.
static long MaxBytesFor(string? contentType) =>
    contentType is not null && contentType.StartsWith("video/", StringComparison.OrdinalIgnoreCase)
        ? 300L * 1024 * 1024  // videos: up to 300 MB
        : 25L * 1024 * 1024;  // photos / voice notes: up to 25 MB

// ---- request DTOs ----
record RegisterRequest(string Email, string Password, string? FullName);
record LoginRequest(string Email, string Password);