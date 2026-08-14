using System.Linq;
using System.Net;
using System.Net.Mail;
using MemoryBox.Models;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Options;

namespace MemoryBox.Services;

public interface IEmailSender
{
    Task SendCapsuleUnlockedEmailAsync(Capsule capsule, CancellationToken ct = default);
}

public class SmtpEmailSender : IEmailSender, IEmailSender<ApplicationUser>
{
    private readonly EmailSettings _settings;
    private readonly AppSettings _appSettings;
    private readonly ILogger<SmtpEmailSender> _logger;

    public SmtpEmailSender(IOptions<EmailSettings> options, IOptions<AppSettings> appOptions, ILogger<SmtpEmailSender> logger)
    {
        _settings = options.Value;
        _appSettings = appOptions.Value;
        _logger = logger;
    }

    public async Task SendCapsuleUnlockedEmailAsync(Capsule capsule, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(_settings.SenderEmail) || string.IsNullOrWhiteSpace(_settings.SenderAppPassword))
        {
            _logger.LogWarning("Email is not configured (Email:SenderEmail / Email:SenderAppPassword missing) — skipping send for capsule {Id}.", capsule.Id);
            throw new InvalidOperationException("Email sender is not configured.");
        }

        var greetingName = string.IsNullOrWhiteSpace(capsule.RecipientName) ? "there" : capsule.RecipientName;

        // Intentionally generic — the notification email must never reveal the capsule's
        // type (message/photo/voice/video/moments) or any of its content. It should only
        // signal that something was sent, so the recipient has to open the link to see it.
        var openLink = $"{_appSettings.BaseUrl.TrimEnd('/')}/?view={capsule.ViewToken}";

        var galleryHtml = "";
        var isSelfCapsule = string.Equals(capsule.RecipientType, "me", StringComparison.OrdinalIgnoreCase);
        var headingTeaser = isSelfCapsule
            ? "a little piece of your past is ready to meet you"
            : "someone left this for you";

        var bodyHtml = $@"
<div style=""font-family:Georgia,'Times New Roman',serif; max-width:560px; margin:0 auto; background:#1b3f30; padding:36px 20px;"">
  <p style=""font-size:12px; letter-spacing:0.08em; text-transform:uppercase; color:#e6c07a; text-align:center; margin:0 0 18px;"">MemoryBox</p>

  <div style=""background:#faf5e9; border-radius:14px; padding:28px; position:relative;"">
    <!-- washi tape corner accents (decorative — most inboxes will render this fine, a few will just ignore it) -->
    <span style=""position:absolute; top:-9px; left:24px; width:48px; height:20px; background:#e6c07a; opacity:0.9; transform:rotate(-5deg); display:block;""></span>
    <span style=""position:absolute; top:-9px; right:24px; width:48px; height:20px; background:#e07a5a; opacity:0.9; transform:rotate(4deg); display:block;""></span>

    <span style=""display:inline-block; background:#e6efe8; color:#2c6e49; font-size:11px; font-weight:700; letter-spacing:0.06em; text-transform:uppercase; padding:4px 10px; border-radius:999px; margin-bottom:14px;"">Unlocked</span>

    <h2 style=""margin:6px 0 6px; font-size:22px; color:#1f2b24;"">Hi {WebUtility.HtmlEncode(greetingName)}, {WebUtility.HtmlEncode(headingTeaser)} 🤍</h2>
    <p style=""color:#5c6d63; font-size:13px; margin:0 0 18px;"">Sealed on {capsule.CreatedAtUtc:MMMM d, yyyy}.</p>

    {galleryHtml}

    <p style=""margin:24px 0 0;"">
      <a href=""{openLink}"" style=""display:inline-block; background:#1b3f30; color:#faf5e9; text-decoration:none; padding:12px 22px; border-radius:999px; font-family:Arial,sans-serif; font-size:14px;"">Open the capsule</a>
    </p>
    <p style=""color:#5c6d63; font-size:12px; margin:14px 0 0;"">This link only opens this capsule — nothing else.</p>
  </div>

  <p style=""text-align:center; color:#c9d6cc; font-size:12px; margin:20px 0 0;"">— MemoryBox, a capsule for the moments worth waiting for.</p>
</div>";

        using var message = new MailMessage
        {
            From = new MailAddress(_settings.SenderEmail, _settings.SenderName),
            Subject = "🔓 Your MemoryBox capsule just unlocked",
            Body = bodyHtml,
            IsBodyHtml = true
        };
        message.To.Add(new MailAddress(capsule.RecipientEmail));

        using var client = new SmtpClient(_settings.SmtpHost, _settings.SmtpPort)
        {
            EnableSsl = true,
            Credentials = new NetworkCredential(_settings.SenderEmail, _settings.SenderAppPassword)
        };

        await client.SendMailAsync(message, ct);
        _logger.LogInformation("Sent unlock email for capsule {Id} to {Email}", capsule.Id, capsule.RecipientEmail);
    }

    // ---- Microsoft.AspNetCore.Identity.IEmailSender<ApplicationUser> ----
    // These are the methods MapIdentityApi's /forgotPassword and /resetPassword
    // endpoints actually call. Without an implementation of THIS interface
    // registered in DI, ASP.NET Core Identity silently falls back to its
    // built-in no-op sender: /forgotPassword still returns 200, but no email
    // is ever sent, and the reset link the front end expects never shows up.

    public Task SendConfirmationLinkAsync(ApplicationUser user, string email, string confirmationLink) =>
        SendAuthEmailAsync(
            user,
            email,
            "Confirm your MemoryBox email",
            "Confirm your email",
            "Tap below to confirm this is really you.",
            confirmationLink,
            "Confirm email");

    public Task SendPasswordResetLinkAsync(ApplicationUser user, string email, string resetLink) =>
        SendAuthEmailAsync(
            user,
            email,
            "Reset your MemoryBox password",
            "Reset your password",
            "Tap below to choose a new password.",
            resetLink,
            "Reset password");

    public Task SendPasswordResetCodeAsync(ApplicationUser user, string email, string resetCode)
    {
        // The forgotPassword endpoint hands us a bare code, not a URL — we have to
        // build the link ourselves so it matches what script.js's
        // tryOpenResetPasswordFromLink() expects: /?email=...&code=...
        var resetLink = $"{_appSettings.BaseUrl.TrimEnd('/')}/?email={Uri.EscapeDataString(email)}&code={Uri.EscapeDataString(resetCode)}";
        return SendAuthEmailAsync(
            user,
            email,
            "Reset your MemoryBox password",
            "Reset your password",
            "Tap below to choose a new password. This link only works once.",
            resetLink,
            "Reset password");
    }

    private async Task SendAuthEmailAsync(ApplicationUser user, string toEmail, string subject, string heading, string message, string link, string buttonLabel)
    {
        if (string.IsNullOrWhiteSpace(_settings.SenderEmail) || string.IsNullOrWhiteSpace(_settings.SenderAppPassword))
        {
            // Don't throw here — this method is called directly inside Identity's built-in
            // /forgotPassword and /confirmEmail request handlers. Throwing bubbles up as an
            // unhandled exception and the caller sees a raw 500, even though nothing else is
            // wrong. Log it loudly (same as the startup banner) and return quietly instead —
            // the request completes normally, it just doesn't deliver a real email until
            // Email:SenderEmail / Email:SenderAppPassword are filled in in appsettings.json.
            _logger.LogWarning("Email is not configured (Email:SenderEmail / Email:SenderAppPassword missing) — skipping '{Subject}' send to {Email}.", subject, toEmail);
            return;
        }

        var greetingName = string.IsNullOrWhiteSpace(user.FullName) ? "there" : user.FullName;

        var bodyHtml = $@"
<div style=""font-family:Georgia,'Times New Roman',serif; max-width:560px; margin:0 auto; background:#1b3f30; padding:36px 20px;"">
  <p style=""font-size:12px; letter-spacing:0.08em; text-transform:uppercase; color:#e6c07a; text-align:center; margin:0 0 18px;"">MemoryBox</p>

  <div style=""background:#faf5e9; border-radius:14px; padding:28px;"">
    <h2 style=""margin:6px 0 6px; font-size:22px; color:#1f2b24;"">Hi {WebUtility.HtmlEncode(greetingName)},</h2>
    <p style=""color:#5c6d63; font-size:14px; margin:0 0 18px;"">{WebUtility.HtmlEncode(message)}</p>

    <p style=""margin:24px 0 0;"">
      <a href=""{link}"" style=""display:inline-block; background:#1b3f30; color:#faf5e9; text-decoration:none; padding:12px 22px; border-radius:999px; font-family:Arial,sans-serif; font-size:14px;"">{WebUtility.HtmlEncode(buttonLabel)}</a>
    </p>
    <p style=""color:#5c6d63; font-size:12px; margin:14px 0 0;"">If you didn't request this, you can safely ignore this email.</p>
  </div>

  <p style=""text-align:center; color:#c9d6cc; font-size:12px; margin:20px 0 0;"">— MemoryBox, a capsule for the moments worth waiting for.</p>
</div>";

        using var mail = new MailMessage
        {
            From = new MailAddress(_settings.SenderEmail, _settings.SenderName),
            Subject = subject,
            Body = bodyHtml,
            IsBodyHtml = true
        };
        mail.To.Add(new MailAddress(toEmail));

        using var client = new SmtpClient(_settings.SmtpHost, _settings.SmtpPort)
        {
            EnableSsl = true,
            Credentials = new NetworkCredential(_settings.SenderEmail, _settings.SenderAppPassword)
        };

        await client.SendMailAsync(mail);
        _logger.LogInformation("Sent '{Subject}' email to {Email}", subject, toEmail);
    }
}