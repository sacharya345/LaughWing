const fs = require("node:fs/promises");
const path = require("node:path");
const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required. Copy .env.example to .env and configure PostgreSQL.");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: true } : undefined,
});

const initialProducts = [
  ["Dry Laphing", "Laphing", "Crispy, savory laphing with a little kick.", 399, "🥢", true],
  ["Jhol Laphing", "Laphing", "Cool, slurpable laphing in a bold, tangy broth.", 499, "🍜", true],
  ["Chicken Laphing", "Laphing", "Our signature laphing with tender chicken.", 599, "🍗", true],
  ["Chicken Keema Noodles", "Chicken", "Wok-tossed noodles with spiced chicken keema.", 999, "🍝", true],
  ["Chicken Chilly", "Chicken", "A spicy, savory favorite with peppers and onion.", 899, "🌶️", true],
  ["Chicken Sausage", "Chicken", "Chicken sausage, cooked fresh to order.", 499, "🌭", true],
  ["Coca Cola", "Drinks", "An ice-cold classic.", 199, "🥤", true],
  ["Fanta", "Drinks", "A bright, fizzy orange drink.", 199, "🍊", true],
  ["Sprite", "Drinks", "Crisp, cool lemon-lime refreshment.", 199, "🍋", true],
  ["Pepsi", "Drinks", "An ice-cold Pepsi, fizzy and refreshing.", 199, "🥤", true],
];

async function initializeDatabase() {
  const schema = await fs.readFile(path.join(__dirname, "..", "db", "schema.sql"), "utf8");
  await pool.query(schema);
  await pool.query("INSERT INTO store_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING");

  const existingProducts = await pool.query("SELECT COUNT(*)::int AS count FROM products");
  if (existingProducts.rows[0].count === 0) {
    for (const [name, category, description, price, emoji, available] of initialProducts) {
      await pool.query(
        `INSERT INTO products (name, category, description, price_cents, emoji, is_available)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [name, category, description, price, emoji, available],
      );
    }
  }

  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminEmail || !adminPassword || adminPassword.length < 12) {
    throw new Error("Set ADMIN_EMAIL and an ADMIN_PASSWORD of at least 12 characters in .env.");
  }
  const existingAdmin = await pool.query("SELECT 1 FROM admin_users WHERE email = $1", [adminEmail]);
  if (existingAdmin.rowCount === 0) {
    const bcrypt = require("bcryptjs");
    const passwordHash = await bcrypt.hash(adminPassword, 12);
    await pool.query(
      "INSERT INTO admin_users (email, password_hash) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING",
      [adminEmail, passwordHash],
    );
  }
}

module.exports = { pool, initializeDatabase };
