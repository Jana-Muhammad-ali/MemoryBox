using Microsoft.AspNetCore.Identity;

namespace MemoryBox.Models;

// Extends the built-in Identity user with the extra field our Register form sends (FullName)
public class ApplicationUser : IdentityUser
{
    public string? FullName { get; set; }
}