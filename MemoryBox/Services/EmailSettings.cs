namespace MemoryBox.Services;

public class EmailSettings
{
    public string SmtpHost { get; set; } = "smtp.gmail.com";
    public int SmtpPort { get; set; } = 587;

    // Your full Gmail address, e.g. "yourname@gmail.com"
    public string SenderEmail { get; set; } = "";

    // A 16-character Gmail "App Password" — NOT your normal Gmail password.
    // Generate one at https://myaccount.google.com/apppasswords (requires 2-Step Verification).
    public string SenderAppPassword { get; set; } = "";

    public string SenderName { get; set; } = "MemoryBox";
}