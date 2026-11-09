process.env.DATABASE_URL ||= "postgres://postgres:postgres@localhost:5432/laughwing";
process.env.SESSION_SECRET ||= "test-session-secret-with-more-than-32-characters";
process.env.ADMIN_EMAIL ||= "owner@example.com";
process.env.ADMIN_PASSWORD ||= "test-password-long-enough";

const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeProduct, normalizeReview, detectImageType, validEmail } = require("../server");

test("normalizes priced menu items into cents", () => {
  const result = normalizeProduct({
    name: "  Chicken Sausage  ",
    category: "Chicken",
    description: "A favorite.",
    price: "4.25",
    emoji: "🌭",
    isAvailable: true,
  });

  assert.deepEqual(result.value, {
    name: "Chicken Sausage",
    category: "Chicken",
    description: "A favorite.",
    emoji: "🌭",
    priceCents: 425,
  });
});

test("keeps an unpriced menu item unavailable", () => {
  const result = normalizeProduct({
    name: "Chicken Sausage",
    category: "Chicken",
    description: "",
    price: "",
    emoji: "🌭",
    isAvailable: false,
  });

  assert.equal(result.value.priceCents, null);
});

test("rejects an available item without a price", () => {
  const result = normalizeProduct({
    name: "Chicken Sausage",
    category: "Chicken",
    description: "",
    price: "",
    emoji: "🌭",
    isAvailable: true,
  });

  assert.match(result.error, /Set a price/);
});

test("rejects invalid menu categories and request bodies", () => {
  assert.match(normalizeProduct({ name: "Soup", category: "Other", emoji: "🥣" }).error, /category/i);
  assert.match(normalizeProduct(null).error, /details/i);
});

test("detects supported image formats from their file signatures", () => {
  assert.equal(detectImageType(Buffer.from([0xff, 0xd8, 0xff, 0x00])), "image/jpeg");
  assert.equal(detectImageType(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), "image/png");
  assert.equal(detectImageType(Buffer.from("RIFF0000WEBP", "ascii")), "image/webp");
  assert.equal(detectImageType(Buffer.from("<svg></svg>")), null);
});

test("validates email addresses for trusted admin account creation", () => {
  assert.equal(validEmail("staff@example.com"), true);
  assert.equal(validEmail("not-an-email"), false);
  assert.equal(validEmail(`staff@${"a".repeat(250)}.com`), false);
});

test("normalizes customer reviews and defaults blank names to Anonymous", () => {
  assert.deepEqual(normalizeReview({
    name: "  Alex   Example ",
    rating: 5,
    review: "  Loved it!\r\nWill order again.  ",
  }).value, {
    name: "Alex Example",
    rating: 5,
    review: "Loved it!\nWill order again.",
  });
  assert.deepEqual(normalizeReview({ name: " ", rating: 4, review: "Great food" }).value, {
    name: "Anonymous",
    rating: 4,
    review: "Great food",
  });
});

test("rejects invalid customer review input", () => {
  assert.match(normalizeReview(null).error, /rating and review/i);
  assert.match(normalizeReview({ rating: 6, review: "Great food" }).error, /1 to 5/i);
  assert.match(normalizeReview({ rating: 4, review: "bad" }).error, /5 and 1,000/i);
  assert.match(normalizeReview({ name: 7, rating: 4, review: "Great food" }).error, /display name/i);
  assert.match(normalizeReview({ name: "x".repeat(81), rating: 4, review: "Great food" }).error, /80 characters/i);
});
