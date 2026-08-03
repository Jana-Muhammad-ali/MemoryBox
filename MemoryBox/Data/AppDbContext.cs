using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using MemoryBox.Models;

namespace MemoryBox.Data;

public class AppDbContext : IdentityDbContext<ApplicationUser>
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    public DbSet<Capsule> Capsules => Set<Capsule>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);
        builder.Entity<Capsule>().HasIndex(c => c.ViewToken).IsUnique();

        // SQLite doesn't persist DateTimeKind, so every DateTime read back from the
        // database comes out as Kind=Unspecified. When that gets serialized to JSON
        // it's missing the trailing "Z", so the browser's `new Date(...)` silently
        // parses it as LOCAL time instead of UTC — making capsules look "unlocked"
        // hours before they actually should be. Forcing Kind=Utc on the way out fixes
        // this at the source for every DateTime column.
        var utcConverter = new Microsoft.EntityFrameworkCore.Storage.ValueConversion.ValueConverter<DateTime, DateTime>(
            v => v,
            v => DateTime.SpecifyKind(v, DateTimeKind.Utc));
        var utcConverterNullable = new Microsoft.EntityFrameworkCore.Storage.ValueConversion.ValueConverter<DateTime?, DateTime?>(
            v => v,
            v => v.HasValue ? DateTime.SpecifyKind(v.Value, DateTimeKind.Utc) : v);

        foreach (var entityType in builder.Model.GetEntityTypes())
        {
            foreach (var property in entityType.GetProperties())
            {
                if (property.ClrType == typeof(DateTime)) property.SetValueConverter(utcConverter);
                else if (property.ClrType == typeof(DateTime?)) property.SetValueConverter(utcConverterNullable);
            }
        }
    }
}