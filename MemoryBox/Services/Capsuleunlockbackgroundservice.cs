using MemoryBox.Data;
using Microsoft.EntityFrameworkCore;

namespace MemoryBox.Services;


public class CapsuleUnlockBackgroundService : BackgroundService
{
    private static readonly TimeSpan PollInterval = TimeSpan.FromSeconds(30);

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<CapsuleUnlockBackgroundService> _logger;

    public CapsuleUnlockBackgroundService(IServiceScopeFactory scopeFactory, ILogger<CapsuleUnlockBackgroundService> logger)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("Capsule unlock background service started (checking every {Seconds}s).", PollInterval.TotalSeconds);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await CheckAndSendDueCapsulesAsync(stoppingToken);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Capsule unlock check failed.");
            }

            try
            {
                await Task.Delay(PollInterval, stoppingToken);
            }
            catch (TaskCanceledException)
            {
                // shutting down
            }
        }
    }

    private async Task CheckAndSendDueCapsulesAsync(CancellationToken stoppingToken)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var emailSender = scope.ServiceProvider.GetRequiredService<IEmailSender>();

        var now = DateTime.UtcNow;

        
        var pending = await db.Capsules.Where(c => !c.IsSent).ToListAsync(stoppingToken);
        _logger.LogInformation("[DIAG] Server UtcNow = {Now:o}", now);
        foreach (var p in pending)
        {
            _logger.LogInformation(
                "[DIAG] Capsule {Id}: UnlockAtUtc = {Unlock:o} (Kind={Kind}) | Due? {Due}",
                p.Id, p.UnlockAtUtc, p.UnlockAtUtc.Kind, p.UnlockAtUtc <= now);
        }

        var due = await db.Capsules
            .Where(c => !c.IsSent && c.UnlockAtUtc <= now)
            .ToListAsync(stoppingToken);

        if (due.Count == 0) return;

        _logger.LogInformation("Found {Count} capsule(s) ready to unlock.", due.Count);

        foreach (var capsule in due)
        {
            try
            {
                await emailSender.SendCapsuleUnlockedEmailAsync(capsule, stoppingToken);
                capsule.IsSent = true;
                capsule.SentAtUtc = DateTime.UtcNow;
            }
            catch (Exception ex)
            {
               
                Console.ForegroundColor = ConsoleColor.Red;
                Console.WriteLine();
                Console.WriteLine("=====================================================================");
                Console.WriteLine($" FAILED TO SEND UNLOCK EMAIL for capsule {capsule.Id} -> {capsule.RecipientEmail}");
                Console.WriteLine($" {ex.GetType().Name}: {ex.Message}");
                var inner = ex.InnerException;
                while (inner is not null)
                {
                    Console.WriteLine($"   -> {inner.GetType().Name}: {inner.Message}");
                    inner = inner.InnerException;
                }
                Console.WriteLine("=====================================================================");
                Console.WriteLine();
                Console.ResetColor();

                _logger.LogError(ex, "Failed to send unlock email for capsule {Id}.", capsule.Id);
            }
        }

        await db.SaveChangesAsync(stoppingToken);
    }
}