using System.ComponentModel.DataAnnotations;

namespace MemoryBox.Models;

// A sealed memory capsule created by a logged-in user.
public class Capsule
{
    public int Id { get; set; }

    [Required]
    public string UserId { get; set; } = null!;
    public ApplicationUser? User { get; set; }

    // "message" | "photo" | "voice" | "video"
    [Required]
    public string Type { get; set; } = "message";

    // Used for the "message" type (and as an optional caption for the others)
    public string? MessageText { get; set; }

    // Comma-separated list of relative URLs under /uploads, e.g. "/uploads/{userId}/{capsuleId}/xyz.jpg"
    public string? MediaPaths { get; set; }

    // "me" | "other"
    public string RecipientType { get; set; } = "me";
    public string? RecipientName { get; set; }

    [Required]
    public string RecipientEmail { get; set; } = null!;

    // A long random token used for the private "open this capsule" email link.
    // Anyone with this exact token can view ONLY this one capsule (nothing else) — and
    // only once it's actually unlocked. It is never guessable from the capsule Id.
    [Required]
    public string ViewToken { get; set; } = null!;

    [Required]
    public DateTime UnlockAtUtc { get; set; }

    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;

    // Flips to true once the background service has actually sent the unlock email.
    public bool IsSent { get; set; } = false;
    public DateTime? SentAtUtc { get; set; }
}