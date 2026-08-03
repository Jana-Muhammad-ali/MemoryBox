using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MemoryBox.Migrations
{
    /// <inheritdoc />
    public partial class AddTrustedContact : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "TrustedContactEmail",
                table: "AspNetUsers",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "TrustedContactName",
                table: "AspNetUsers",
                type: "TEXT",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "TrustedContactEmail",
                table: "AspNetUsers");

            migrationBuilder.DropColumn(
                name: "TrustedContactName",
                table: "AspNetUsers");
        }
    }
}
