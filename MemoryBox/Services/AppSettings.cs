namespace MemoryBox.Services;

public class AppSettings
{
    // The public URL people reach your site at, no trailing slash — used to build the
    // private "open this capsule" link that goes out in the unlock email.
    // e.g. "https://memorybox.com" in production, "http://localhost:5000" while developing.
    public string BaseUrl { get; set; } = "http://localhost:5000";
}