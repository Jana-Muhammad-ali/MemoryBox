using System.Linq;
using System.Net;
using System.Net.Mail;
using MemoryBox.Models;
using Microsoft.Extensions.Options;

namespace MemoryBox.Services;

public interface IEmailSender
{
    Task SendCapsuleUnlockedEmailAsync(Capsule capsule, CancellationToken ct = default);
}

// Sends mail through plain Gmail SMTP (smtp.gmail.com:587) using an App Password.
public class SmtpEmailSender : IEmailSender
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
        var typeLabel = capsule.Type switch
        {
            "photo" => "photo capsule",
            "voice" => "voice note",
            "video" => "video",
            "moments" => "collection of moments",
            _ => "message"
        };

        // Private link — only works for THIS capsule, for anyone who has it. No login required.
        var openLink = $"{_appSettings.BaseUrl.TrimEnd('/')}/?view={capsule.ViewToken}";

        var mediaPaths = string.IsNullOrEmpty(capsule.MediaPaths)
            ? Array.Empty<string>()
            : capsule.MediaPaths.Split(',', StringSplitOptions.RemoveEmptyEntries);

        // For "moments" capsules, drop a preview gallery straight into the email —
        // most inboxes load remote <img> fine as long as BaseUrl is a real public
        // URL (not localhost) by the time this actually gets sent.
        var galleryHtml = "";
        if (capsule.Type == "moments" && mediaPaths.Length > 0)
        {
            var imgTags = mediaPaths
                .Where(p => !p.EndsWith(".webm", StringComparison.OrdinalIgnoreCase)) // skip voice notes here
                .Select(p =>
                {
                    var fullUrl = $"{_appSettings.BaseUrl.TrimEnd('/')}{p}";
                    var isVideo = p.EndsWith(".mp4", StringComparison.OrdinalIgnoreCase)
                        || p.EndsWith(".mov", StringComparison.OrdinalIgnoreCase)
                        || p.EndsWith(".webm", StringComparison.OrdinalIgnoreCase);
                    // email clients can't play <video>, so videos get a labeled link/thumbnColor block instead
                    return isVideo
                        ? $@"<a href=""{fullUrl}"" style=""display:block; background:#1b3f30; color:#faf5e9; text-align:center; padding:26px 10px; border-radius:10px; margin-bottom:10px; text-decoration:none; font-family:Arial,sans-serif; font-size:13px;"">🎬 Watch video</a>"
                        : $@"<img src=""{fullUrl}"" style=""width:100%; display:block; border-radius:10px; margin-bottom:10px;"">";
                });
            galleryHtml = string.Join("", imgTags);
        }

        var momentsCountLine = capsule.Type == "moments"
            ? $"<p style=\"color:#5c6d63; font-size:13px; margin:0 0 20px;\">{mediaPaths.Length} moment{(mediaPaths.Length == 1 ? "" : "s")}, gathered over time — now ready.</p>"
            : "";

        var bodyHtml = $@"
<div style=""font-family:Georgia,'Times New Roman',serif; max-width:560px; margin:0 auto; background:#1b3f30; padding:36px 20px;"">
  <p style=""font-size:12px; letter-spacing:0.08em; text-transform:uppercase; color:#e6c07a; text-align:center; margin:0 0 18px;"">MemoryBox</p>

  <div style=""background:#faf5e9; border-radius:14px; padding:28px; position:relative;"">
    <!-- washi tape corner accents (decorative — most inboxes will render this fine, a few will just ignore it) -->
    <span style=""position:absolute; top:-9px; left:24px; width:48px; height:20px; background:#e6c07a; opacity:0.9; transform:rotate(-5deg); display:block;""></span>
    <span style=""position:absolute; top:-9px; right:24px; width:48px; height:20px; background:#e07a5a; opacity:0.9; transform:rotate(4deg); display:block;""></span>

    <span style=""display:inline-block; background:#e6efe8; color:#2c6e49; font-size:11px; font-weight:700; letter-spacing:0.06em; text-transform:uppercase; padding:4px 10px; border-radius:999px; margin-bottom:14px;"">Unlocked</span>

    <h2 style=""margin:6px 0 6px; font-size:22px; color:#1f2b24;"">Hi {WebUtility.HtmlEncode(greetingName)}, a {typeLabel} just unlocked 🔓</h2>
    <p style=""color:#5c6d63; font-size:13px; margin:0 0 18px;"">Sealed on {capsule.CreatedAtUtc:MMMM d, yyyy}.</p>
    {momentsCountLine}

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
}