require("dotenv").config();

const path = require("node:path");
const bcrypt = require("bcryptjs");
const express = require("express");
const session = require("express-session");
const connectPgSimple = require("connect-pg-simple");
const helmet = require("helmet");
const { rateLimit } = require("express-rate-limit");
const multer = require("multer");
const { pool, initializeDatabase } = require("./src/database");
const { validateNotificationConfig, sendOrderNotifications } = require("./src/notifications");
const crypto = require("node:crypto");

const app = express();
const port = Number(process.env.PORT || 3000);
const PgSession = connectPgSimple(session);
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const orderStatuses = new Set(["pending", "confirmed", "preparing", "ready", "completed", "cancelled"]);

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  throw new Error("SESSION_SECRET must contain at least 32 characters.");
}

app.disable("x-powered-by");
app.set("trust proxy", process.env.TRUST_PROXY === "true" ? 1 : false);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      imgSrc: ["'self'", "data:", "blob:"],
    },
  },
}));
app.use(express.json({ limit: "32kb" }));
app.use(session({
  store: new PgSession({ pool, tableName: "user_sessions", createTableIfMissing: true }),
  name: "laughwing.sid",
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: 8 * 60 * 60 * 1000,
  },
}));

const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many sign-in attempts. Please try again in 15 minutes." },
});
const orderLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 8,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many order attempts. Please wait a few minutes and try again." },
});
const visitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});
const reviewLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Thanks for sharing your feedback. Please try again later." },
});
const acceptedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0, parts: 1 },
  fileFilter(_req, file, callback) {
    if (!acceptedImageTypes.has(file.mimetype)) {
      const error = new Error("Choose a JPEG, PNG, or WebP image.");
      error.status = 400;
      return callback(error);
    }
    callback(null, true);
  },
});

function handleImageUpload(req, res, next) {
  imageUpload.single("image")(req, res, (error) => {
    if (!error) return next();
    if (error instanceof multer.MulterError) error.status = 400;
    next(error);
  });
}

function detectImageType(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return "image/png";
  }
  if (buffer.length >= 12 &&
      buffer.toString("ascii", 0, 4) === "RIFF" &&
      buffer.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }
  return null;
}

function validEmail(value) {
  return typeof value === "string" && value.length <= 254 && emailPattern.test(value);
}

function requireAdmin(req, res, next) {
  if (!req.session.adminId) {
    return res.status(401).json({ error: "Please sign in to continue." });
  }
  next();
}

function requireCsrf(req, res, next) {
  if (!req.session.csrfToken || req.get("x-csrf-token") !== req.session.csrfToken) {
    return res.status(403).json({ error: "Your session expired. Refresh the page and try again." });
  }
  next();
}

function normalizeProduct(body = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Enter the menu item details." };
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const category = body.category;
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const emoji = typeof body.emoji === "string" ? body.emoji.trim() : "";
  const price = body.price === "" || body.price === null || body.price === undefined
    ? null
    : Number(body.price);

  if (!name || name.length > 80) {
    return { error: "Product name is required and must be 80 characters or fewer." };
  }
  if (!["Laphing", "Chicken", "Drinks"].includes(category)) {
    return { error: "Choose a valid menu category." };
  }
  if (description.length > 240 || !emoji || emoji.length > 8) {
    return { error: "Add a short description (up to 240 characters) and one menu emoji." };
  }
  if (price !== null && (!Number.isFinite(price) || price < 0 || price > 99999)) {
    return { error: "Enter a valid price between €0.00 and €99,999.00." };
  }
  if (body.isAvailable && price === null) {
    return { error: "Set a price before making this product available." };
  }
  return { value: { name, category, description, emoji, priceCents: price === null ? null : Math.round(price * 100) } };
}

function normalizeReview(body = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Enter your rating and review." };
  }
  const name = typeof body.name === "string" ? body.name.trim().replace(/\s+/g, " ") : "";
  const review = typeof body.review === "string" ? body.review.trim().replace(/\r\n?/g, "\n") : "";
  if (body.name !== undefined && typeof body.name !== "string") {
    return { error: "Enter a valid display name." };
  }
  if (name.length > 80) {
    return { error: "Your name must be 80 characters or fewer." };
  }
  if (!Number.isInteger(body.rating) || body.rating < 1 || body.rating > 5) {
    return { error: "Choose a rating from 1 to 5 stars." };
  }
  if (review.length < 5 || review.length > 1000) {
    return { error: "Your review must be between 5 and 1,000 characters." };
  }
  return { value: { name: name || "Anonymous", rating: body.rating, review } };
}

function serializeProduct(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    description: row.description,
    price: row.price_cents === null ? null : row.price_cents / 100,
    emoji: row.emoji,
    isAvailable: row.is_available,
    imageUrl: row.has_image
      ? `/api/menu/${row.id}/image?v=${new Date(row.image_updated_at).getTime()}`
      : null,
  };
}

app.post("/api/visits", visitLimiter, asyncRoute(async (_req, res) => {
  await pool.query("INSERT INTO website_visits (page_path) VALUES ('/')");
  res.status(204).end();
}));

app.get("/api/menu", asyncRoute(async (_req, res) => {
  const [products, settings] = await Promise.all([
    pool.query(
      `SELECT id, name, category, description, price_cents, emoji, is_available,
              image_data IS NOT NULL AS has_image, image_updated_at
       FROM products ORDER BY CASE category WHEN 'Laphing' THEN 1 WHEN 'Chicken' THEN 2 ELSE 3 END, id`,
    ),
    pool.query("SELECT store_open, pickup_enabled, delivery_enabled, delivery_fee_cents, currency_code FROM store_settings WHERE id = 1"),
  ]);
  res.json({
    products: products.rows.map(serializeProduct),
    settings: {
      storeOpen: settings.rows[0].store_open,
      pickupEnabled: settings.rows[0].pickup_enabled,
      deliveryEnabled: settings.rows[0].delivery_enabled,
      deliveryFee: settings.rows[0].delivery_fee_cents / 100,
      currencyCode: settings.rows[0].currency_code.trim(),
    },
  });
}));

app.get("/api/menu/:id/image", asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).end();
  const result = await pool.query(
    "SELECT image_data, image_mime_type, image_updated_at FROM products WHERE id = $1 AND image_data IS NOT NULL",
    [id],
  );
  if (!result.rowCount) return res.status(404).end();
  const image = result.rows[0];
  res.set({
    "Content-Type": image.image_mime_type,
    "Cache-Control": "public, max-age=3600",
    "X-Content-Type-Options": "nosniff",
    "Last-Modified": new Date(image.image_updated_at).toUTCString(),
  });
  res.send(image.image_data);
}));

app.get("/api/reviews", asyncRoute(async (_req, res) => {
  const [reviews, summary] = await Promise.all([
    pool.query(
      `SELECT id, reviewer_name, rating, review_text, created_at
       FROM customer_reviews ORDER BY created_at DESC, id DESC LIMIT 50`,
    ),
    pool.query(
      "SELECT COUNT(*)::int AS count, COALESCE(AVG(rating), 0)::numeric(3,2) AS average FROM customer_reviews",
    ),
  ]);
  res.json({
    reviews: reviews.rows.map((review) => ({
      id: review.id,
      name: review.reviewer_name,
      rating: review.rating,
      review: review.review_text,
      createdAt: review.created_at,
    })),
    count: summary.rows[0].count,
    average: Number(summary.rows[0].average),
  });
}));

app.post("/api/reviews", reviewLimiter, asyncRoute(async (req, res) => {
  const normalized = normalizeReview(req.body);
  if (normalized.error) return res.status(400).json({ error: normalized.error });
  const result = await pool.query(
    `INSERT INTO customer_reviews (reviewer_name, rating, review_text)
     VALUES ($1, $2, $3)
     RETURNING id, reviewer_name, rating, review_text, created_at`,
    [normalized.value.name, normalized.value.rating, normalized.value.review],
  );
  const review = result.rows[0];
  res.status(201).json({
    review: {
      id: review.id,
      name: review.reviewer_name,
      rating: review.rating,
      review: review.review_text,
      createdAt: review.created_at,
    },
  });
}));

app.post("/api/orders", orderLimiter, asyncRoute(async (req, res) => {
  const { name, email, phone, fulfillment, address, notes, items } = req.body || {};
  const customerName = typeof name === "string" ? name.trim().replace(/\s+/g, " ") : "";
  const customerEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
  const customerPhone = typeof phone === "string" ? phone.trim().replace(/\s+/g, " ") : "";
  const deliveryAddress = typeof address === "string" ? address.trim().replace(/\s+/g, " ") : "";
  const orderNotes = typeof notes === "string" ? notes.trim().replace(/\s+/g, " ") : "";

  if (customerName.length < 2 || customerName.length > 100) {
    return res.status(400).json({ error: "Enter a name between 2 and 100 characters." });
  }
  if ((!customerEmail && !customerPhone) ||
      (customerEmail && (customerEmail.length > 254 || !emailPattern.test(customerEmail))) ||
      customerPhone.length > 30 || (customerPhone && (customerPhone.length < 6 || !/^[+()\d.\-\s]+$/.test(customerPhone)))) {
    return res.status(400).json({ error: "Enter a valid email address or phone number so we can reach you." });
  }
  if (!["pickup", "delivery"].includes(fulfillment)) {
    return res.status(400).json({ error: "Choose pickup or delivery." });
  }
  if (fulfillment === "delivery" && (deliveryAddress.length < 5 || deliveryAddress.length > 300)) {
    return res.status(400).json({ error: "Enter a delivery address between 5 and 300 characters." });
  }
  if (orderNotes.length > 500) {
    return res.status(400).json({ error: "Order notes must be 500 characters or fewer." });
  }
  if (!Array.isArray(items) || items.length === 0 || items.length > 20) {
    return res.status(400).json({ error: "Add at least one menu item to your order." });
  }

  const requestedItems = new Map();
  for (const item of items) {
    const id = item?.productId;
    const quantity = item?.quantity;
    if (!Number.isInteger(id) || id < 1 || !Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
      return res.status(400).json({ error: "One of the selected menu items is invalid." });
    }
    requestedItems.set(id, (requestedItems.get(id) || 0) + quantity);
  }
  if ([...requestedItems.values()].some((quantity) => quantity > 20)) {
    return res.status(400).json({ error: "The maximum quantity for each item is 20." });
  }

  const settingsResult = await pool.query(
    "SELECT store_open, pickup_enabled, delivery_enabled, delivery_fee_cents, currency_code FROM store_settings WHERE id = 1",
  );
  const settings = settingsResult.rows[0];
  if (!settings.store_open) {
    return res.status(409).json({ error: "Online ordering is temporarily closed." });
  }
  if ((fulfillment === "pickup" && !settings.pickup_enabled) ||
      (fulfillment === "delivery" && !settings.delivery_enabled)) {
    return res.status(409).json({ error: `We're not accepting ${fulfillment} orders right now.` });
  }

  const productResult = await pool.query(
    `SELECT id, name, price_cents FROM products
     WHERE id = ANY($1::int[]) AND is_available = true AND price_cents IS NOT NULL`,
    [[...requestedItems.keys()]],
  );
  if (productResult.rows.length !== requestedItems.size) {
    return res.status(400).json({ error: "A selected item is no longer available. Refresh the menu and try again." });
  }

  const productsById = new Map(productResult.rows.map((product) => [product.id, product]));
  const lineItems = [...requestedItems].map(([id, quantity]) => ({
    ...productsById.get(id),
    quantity,
  }));
  const subtotalCents = lineItems.reduce((sum, item) => sum + item.price_cents * item.quantity, 0);
  const deliveryFeeCents = fulfillment === "delivery" ? settings.delivery_fee_cents : 0;
  const client = await pool.connect();
  let order;
  try {
    await client.query("BEGIN");
    const orderResult = await client.query(
      `INSERT INTO orders
       (customer_name, customer_email, customer_phone, fulfillment, delivery_address, notes,
        subtotal_cents, delivery_fee_cents, total_cents)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, customer_name, customer_email, customer_phone, fulfillment, delivery_address,
                 notes, subtotal_cents, delivery_fee_cents, total_cents`,
      [
        customerName,
        customerEmail || null,
        customerPhone || null,
        fulfillment,
        fulfillment === "delivery" ? deliveryAddress : null,
        orderNotes,
        subtotalCents,
        deliveryFeeCents,
        subtotalCents + deliveryFeeCents,
      ],
    );
    order = orderResult.rows[0];
    order.items = [];
    for (const item of lineItems) {
      await client.query(
        `INSERT INTO order_items (order_id, product_id, product_name, unit_price_cents, quantity)
         VALUES ($1, $2, $3, $4, $5)`,
        [order.id, item.id, item.name, item.price_cents, item.quantity],
      );
      order.items.push({
        product_name: item.name,
        unit_price_cents: item.price_cents,
        quantity: item.quantity,
      });
    }
    await client.query(
      "INSERT INTO admin_notifications (order_id, notification_type) VALUES ($1, 'order_placed')",
      [order.id],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const notificationStatus = await sendOrderNotifications(order);
  await pool.query("UPDATE orders SET notification_status = $1 WHERE id = $2", [notificationStatus, order.id]);
  res.status(201).json({
    orderId: order.id,
    total: order.total_cents / 100,
    notificationStatus,
    message: "Your order is in! We'll be in touch to confirm it.",
  });
}));

app.post("/api/admin/login", adminLoginLimiter, asyncRoute(async (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const result = await pool.query("SELECT id, email, password_hash FROM admin_users WHERE email = $1", [email]);
  const user = result.rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: "Email or password is incorrect." });
  }

  await new Promise((resolve, reject) => {
    req.session.regenerate((error) => error ? reject(error) : resolve());
  });
  req.session.adminId = user.id;
  req.session.adminEmail = user.email;
  req.session.csrfToken = crypto.randomBytes(32).toString("hex");
  res.json({ email: user.email, csrfToken: req.session.csrfToken });
}));

app.get("/api/admin/session", requireAdmin, (req, res) => {
  res.json({ email: req.session.adminEmail, csrfToken: req.session.csrfToken });
});

app.post("/api/admin/logout", requireAdmin, requireCsrf, (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie("laughwing.sid");
    res.status(204).end();
  });
});

app.get("/api/admin/dashboard", requireAdmin, asyncRoute(async (_req, res) => {
  const [orders, products, settings, visits, recentVisits, admins, notifications] = await Promise.all([
    pool.query(
      `SELECT o.id, o.customer_name, o.customer_email, o.customer_phone, o.fulfillment,
              o.delivery_address, o.notes, o.status, o.notification_status, o.subtotal_cents,
              o.delivery_fee_cents, o.total_cents, o.created_at,
              COALESCE(json_agg(json_build_object(
                'name', i.product_name, 'quantity', i.quantity,
                'price', i.unit_price_cents / 100.0
              )) FILTER (WHERE i.id IS NOT NULL), '[]'::json) AS items
       FROM orders o
       LEFT JOIN order_items i ON i.order_id = o.id
       GROUP BY o.id
       ORDER BY o.created_at DESC
       LIMIT 100`,
    ),
    pool.query(
      `SELECT id, name, category, description, price_cents, emoji, is_available,
              image_data IS NOT NULL AS has_image, image_updated_at
       FROM products ORDER BY id`,
    ),
    pool.query(
      "SELECT store_open, pickup_enabled, delivery_enabled, delivery_fee_cents, currency_code FROM store_settings WHERE id = 1",
    ),
    pool.query(
      `SELECT COUNT(*)::int AS all_time,
              COUNT(*) FILTER (WHERE visited_at >= date_trunc('day', now()))::int AS today
       FROM website_visits`,
    ),
    pool.query(
      `SELECT id, page_path,
              to_char(visited_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS visited_at
       FROM website_visits ORDER BY visited_at DESC, id DESC LIMIT 51`,
    ),
    pool.query("SELECT id, email, created_at FROM admin_users ORDER BY created_at, id"),
    pool.query("SELECT COUNT(*)::int AS unread_count FROM admin_notifications WHERE is_read = false"),
  ]);
  res.json({
    orders: orders.rows.map((order) => ({
      ...order,
      total: order.total_cents / 100,
      subtotal: order.subtotal_cents / 100,
      deliveryFee: order.delivery_fee_cents / 100,
    })),
    products: products.rows.map(serializeProduct),
    visitorStats: {
      allTime: visits.rows[0].all_time,
      today: visits.rows[0].today,
      recent: recentVisits.rows.slice(0, 50),
      hasMore: recentVisits.rows.length > 50,
    },
    admins: admins.rows,
    unreadNotifications: notifications.rows[0].unread_count,
    settings: {
      storeOpen: settings.rows[0].store_open,
      pickupEnabled: settings.rows[0].pickup_enabled,
      deliveryEnabled: settings.rows[0].delivery_enabled,
      deliveryFee: settings.rows[0].delivery_fee_cents / 100,
      currencyCode: settings.rows[0].currency_code.trim(),
    },
  });
}));

app.get("/api/admin/notifications", requireAdmin, asyncRoute(async (_req, res) => {
  const [notifications, unread] = await Promise.all([
    pool.query(
      `SELECT n.id, n.order_id, n.notification_type, n.is_read, n.created_at,
              o.customer_name, o.fulfillment, o.total_cents
       FROM admin_notifications n
       JOIN orders o ON o.id = n.order_id
       ORDER BY n.created_at DESC, n.id DESC
       LIMIT 50`,
    ),
    pool.query("SELECT COUNT(*)::int AS count FROM admin_notifications WHERE is_read = false"),
  ]);
  res.json({
    notifications: notifications.rows.map((notification) => ({
      ...notification,
      total: notification.total_cents / 100,
    })),
    unreadCount: unread.rows[0].count,
  });
}));

app.patch("/api/admin/notifications/:id", requireAdmin, requireCsrf, asyncRoute(async (req, res) => {
  const id = req.params.id;
  if (!/^\d{1,19}$/.test(id) || BigInt(id) < 1n || BigInt(id) > 9223372036854775807n) {
    return res.status(400).json({ error: "Invalid notification." });
  }
  const result = await pool.query(
    "UPDATE admin_notifications SET is_read = true WHERE id = $1 RETURNING id, is_read",
    [id],
  );
  if (!result.rowCount) return res.status(404).json({ error: "Notification not found." });
  res.json({ notification: result.rows[0] });
}));

app.post("/api/admin/notifications/read-all", requireAdmin, requireCsrf, asyncRoute(async (_req, res) => {
  await pool.query("UPDATE admin_notifications SET is_read = true WHERE is_read = false");
  res.status(204).end();
}));

app.get("/api/admin/visits", requireAdmin, asyncRoute(async (req, res) => {
  const before = typeof req.query.before === "string" ? req.query.before : "";
  const beforeId = typeof req.query.beforeId === "string" ? req.query.beforeId : "";
  let result;
  if (before || beforeId) {
    const visitedAt = new Date(before);
    const validBeforeId = /^\d{1,19}$/.test(beforeId) &&
      BigInt(beforeId) > 0n && BigInt(beforeId) <= 9223372036854775807n;
    if (!before || before.length > 40 || !validBeforeId || Number.isNaN(visitedAt.getTime())) {
      return res.status(400).json({ error: "That visit page is invalid." });
    }
    result = await pool.query(
      `SELECT id, page_path,
              to_char(visited_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS visited_at
       FROM website_visits
       WHERE (visited_at, id) < ($1::timestamptz, $2::bigint)
       ORDER BY visited_at DESC, id DESC LIMIT 51`,
      [visitedAt.toISOString(), beforeId],
    );
  } else {
    result = await pool.query(
      `SELECT id, page_path,
              to_char(visited_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS visited_at
       FROM website_visits ORDER BY visited_at DESC, id DESC LIMIT 51`,
    );
  }
  res.json({ visits: result.rows.slice(0, 50), hasMore: result.rows.length > 50 });
}));

app.post("/api/admin/products", requireAdmin, requireCsrf, asyncRoute(async (req, res) => {
  const product = normalizeProduct(req.body);
  if (product.error) return res.status(400).json({ error: product.error });
  const result = await pool.query(
    `INSERT INTO products (name, category, description, price_cents, emoji, is_available)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, name, category, description, price_cents, emoji, is_available,
               image_data IS NOT NULL AS has_image, image_updated_at`,
    [
      product.value.name,
      product.value.category,
      product.value.description,
      product.value.priceCents,
      product.value.emoji,
      req.body.isAvailable === true && product.value.priceCents !== null,
    ],
  );
  res.status(201).json({ product: serializeProduct(result.rows[0]) });
}));

app.post("/api/admin/admins", requireAdmin, requireCsrf, asyncRoute(async (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!validEmail(email)) {
    return res.status(400).json({ error: "Enter a valid admin email address." });
  }
  if (password.length < 12 || password.length > 128) {
    return res.status(400).json({ error: "Admin passwords must be between 12 and 128 characters." });
  }
  const passwordHash = await bcrypt.hash(password, 12);
  const result = await pool.query(
    `INSERT INTO admin_users (email, password_hash)
     VALUES ($1, $2)
     ON CONFLICT (email) DO NOTHING
     RETURNING id, email, created_at`,
    [email, passwordHash],
  );
  if (!result.rowCount) {
    return res.status(409).json({ error: "An admin account with that email already exists." });
  }
  res.status(201).json({ admin: result.rows[0] });
}));

app.put("/api/admin/products/:id", requireAdmin, requireCsrf, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const product = normalizeProduct(req.body);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Invalid product." });
  if (product.error) return res.status(400).json({ error: product.error });
  const result = await pool.query(
    `UPDATE products
     SET name = $1, category = $2, description = $3, price_cents = $4, emoji = $5,
         is_available = $6, updated_at = now()
     WHERE id = $7
     RETURNING id, name, category, description, price_cents, emoji, is_available,
               image_data IS NOT NULL AS has_image, image_updated_at`,
    [
      product.value.name,
      product.value.category,
      product.value.description,
      product.value.priceCents,
      product.value.emoji,
      req.body.isAvailable === true && product.value.priceCents !== null,
      id,
    ],
  );
  if (!result.rowCount) return res.status(404).json({ error: "Product not found." });
  res.json({ product: serializeProduct(result.rows[0]) });
}));

app.post("/api/admin/products/:id/image", requireAdmin, requireCsrf, handleImageUpload, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Invalid product." });
  if (!req.file) return res.status(400).json({ error: "Choose an image to upload." });
  const imageType = detectImageType(req.file.buffer);
  if (!imageType || imageType !== req.file.mimetype) {
    return res.status(400).json({ error: "The image contents do not match a supported JPEG, PNG, or WebP file." });
  }
  const result = await pool.query(
    `UPDATE products
     SET image_data = $1, image_mime_type = $2, image_updated_at = now(), updated_at = now()
     WHERE id = $3
     RETURNING id, name, category, description, price_cents, emoji, is_available,
               image_data IS NOT NULL AS has_image, image_updated_at`,
    [req.file.buffer, imageType, id],
  );
  if (!result.rowCount) return res.status(404).json({ error: "Product not found." });
  res.json({ product: serializeProduct(result.rows[0]) });
}));

app.delete("/api/admin/products/:id/image", requireAdmin, requireCsrf, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Invalid product." });
  const result = await pool.query(
    `UPDATE products
     SET image_data = NULL, image_mime_type = NULL, image_updated_at = NULL, updated_at = now()
     WHERE id = $1 AND image_data IS NOT NULL
     RETURNING id`,
    [id],
  );
  if (!result.rowCount) return res.status(404).json({ error: "Product image not found." });
  res.status(204).end();
}));

app.delete("/api/admin/products/:id", requireAdmin, requireCsrf, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Invalid product." });
  const result = await pool.query("DELETE FROM products WHERE id = $1", [id]);
  if (!result.rowCount) return res.status(404).json({ error: "Product not found." });
  res.status(204).end();
}));

app.put("/api/admin/settings", requireAdmin, requireCsrf, asyncRoute(async (req, res) => {
  const deliveryFee = Number(req.body?.deliveryFee);
  if (!Number.isFinite(deliveryFee) || deliveryFee < 0 || deliveryFee > 99999) {
    return res.status(400).json({ error: "Enter a valid delivery fee between €0.00 and €99,999.00." });
  }
  const result = await pool.query(
    `UPDATE store_settings
     SET store_open = $1, pickup_enabled = $2, delivery_enabled = $3,
         delivery_fee_cents = $4, updated_at = now()
     WHERE id = 1
     RETURNING store_open, pickup_enabled, delivery_enabled, delivery_fee_cents, currency_code`,
    [
      req.body.storeOpen === true,
      req.body.pickupEnabled === true,
      req.body.deliveryEnabled === true,
      Math.round(deliveryFee * 100),
    ],
  );
  res.json({
    settings: {
      storeOpen: result.rows[0].store_open,
      pickupEnabled: result.rows[0].pickup_enabled,
      deliveryEnabled: result.rows[0].delivery_enabled,
      deliveryFee: result.rows[0].delivery_fee_cents / 100,
      currencyCode: result.rows[0].currency_code.trim(),
    },
  });
}));

app.patch("/api/admin/orders/:id", requireAdmin, requireCsrf, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const status = req.body?.status;
  if (!Number.isInteger(id) || id < 1 || !orderStatuses.has(status)) {
    return res.status(400).json({ error: "Choose a valid order status." });
  }
  const result = await pool.query(
    "UPDATE orders SET status = $1 WHERE id = $2 RETURNING id, status",
    [status, id],
  );
  if (!result.rowCount) return res.status(404).json({ error: "Order not found." });
  res.json({ order: result.rows[0] });
}));

app.post("/api/admin/orders/:id/retry-notification", requireAdmin, requireCsrf, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Invalid order." });
  const result = await pool.query(
    `SELECT o.id, o.customer_name, o.customer_email, o.customer_phone, o.fulfillment,
            o.delivery_address, o.notes, o.total_cents,
            COALESCE(json_agg(json_build_object(
              'product_name', i.product_name, 'quantity', i.quantity,
              'unit_price_cents', i.unit_price_cents
            )) FILTER (WHERE i.id IS NOT NULL), '[]'::json) AS items
     FROM orders o LEFT JOIN order_items i ON i.order_id = o.id
     WHERE o.id = $1 GROUP BY o.id`,
    [id],
  );
  if (!result.rowCount) return res.status(404).json({ error: "Order not found." });
  const notificationStatus = await sendOrderNotifications(result.rows[0]);
  await pool.query("UPDATE orders SET notification_status = $1 WHERE id = $2", [notificationStatus, id]);
  res.json({ notificationStatus });
}));

app.get("/api/health", asyncRoute(async (_req, res) => {
  await pool.query("SELECT 1");
  res.json({ status: "ok" });
}));

app.get("/sitemap.xml", (_req, res) => {
  const siteUrl = process.env.SITE_URL || `http://localhost:${port}`;
  let baseUrl;
  try {
    baseUrl = new URL(siteUrl);
  } catch {
    return res.status(500).type("text/plain").send("SITE_URL must be a valid absolute URL.");
  }
  if (!["http:", "https:"].includes(baseUrl.protocol)) {
    return res.status(500).type("text/plain").send("SITE_URL must use HTTP or HTTPS.");
  }
  res.type("application/xml").send(
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${new URL("/", baseUrl).toString()}</loc><changefreq>weekly</changefreq><priority>1.0</priority></url></urlset>`,
  );
});

app.get("/robots.txt", (_req, res) => {
  const siteUrl = process.env.SITE_URL || `http://localhost:${port}`;
  let baseUrl;
  try {
    baseUrl = new URL(siteUrl);
  } catch {
    return res.status(500).type("text/plain").send("SITE_URL must be a valid absolute URL.");
  }
  if (!["http:", "https:"].includes(baseUrl.protocol)) {
    return res.status(500).type("text/plain").send("SITE_URL must use HTTP or HTTPS.");
  }
  res.type("text/plain").send(
    `User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${new URL("/sitemap.xml", baseUrl).toString()}`,
  );
});

app.get("/admin", (_req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));

app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ error: "That endpoint was not found." });
  }
  res.status(404).sendFile(path.join(__dirname, "public", "index.html"));
});

app.use((error, _req, res, _next) => {
  console.error("Request failed:", error.message);
  if (res.headersSent) return;
  const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 500
    ? error.status
    : 500;
  res.status(status).json({
    error: status < 500 && error.message
      ? error.message
      : "Something went wrong. Please try again.",
  });
});

async function start() {
  validateNotificationConfig();
  await initializeDatabase();
  const server = app.listen(port, () => {
    console.log(`Laugh-Wing is running at http://localhost:${port}`);
  });
  const shutdown = () => {
    server.close(() => {
      pool.end().then(() => process.exit(0)).catch((error) => {
        console.error("Database shutdown failed:", error.message);
        process.exit(1);
      });
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (require.main === module) {
  start().catch((error) => {
    console.error("Startup failed:", error.message);
    process.exitCode = 1;
  });
}

module.exports = { app, normalizeProduct, normalizeReview, detectImageType, validEmail };
