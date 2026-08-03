using Microsoft.AspNetCore.Identity;

namespace MemoryBox.Models;

public class ApplicationUser : IdentityUser
{
    public string? FullName { get; set; }


    public string? TrustedContactName { get; set; }
    public string? TrustedContactEmail { get; set; }
}