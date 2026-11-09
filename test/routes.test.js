process.env.DATABASE_URL ||= "postgres://postgres:postgres@localhost:5432/laughwing";
process.env.SESSION_SECRET ||= "test-session-secret-with-more-than-32-characters";
process.env.ADMIN_EMAIL ||= "owner@example.com";
process.env.ADMIN_PASSWORD ||= "test-password-long-enough";

const test = require("node:test");
const assert = require("node:assert/strict");
const { app } = require("../server");
const { pool } = require("../src/database");

async function withServer(run) {
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const { port } = server.address();
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

test("admin account creation rejects unauthenticated public signups", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/admin/admins`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "stranger@example.com", password: "a-very-long-password" }),
    });

    assert.equal(response.status, 401);
    assert.match((await response.json()).error, /sign in/i);
  });
});

test("admin notifications require an authenticated admin session", async () => {
  await withServer(async (baseUrl) => {
    const requests = [
      fetch(`${baseUrl}/api/admin/notifications`),
      fetch(`${baseUrl}/api/admin/notifications/1`, { method: "PATCH" }),
      fetch(`${baseUrl}/api/admin/notifications/read-all`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    ];
    const responses = await Promise.all(requests);
    assert.deepEqual(responses.map((response) => response.status), [401, 401, 401]);
  });
});

test("anonymous visits record only a page path, never request identifiers", async () => {
  const originalQuery = pool.query;
  let insertedQuery = "";
  let insertedValues;
  pool.query = async (query, values) => {
    insertedQuery = query;
    insertedValues = values;
    return { rows: [], rowCount: 1 };
  };

  try {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/visits`, {
        method: "POST",
      });

      assert.equal(response.status, 204);
    });
  } finally {
    pool.query = originalQuery;
  }

  assert.equal(insertedQuery, "INSERT INTO website_visits (page_path) VALUES ('/')");
  assert.equal(insertedValues, undefined);
  assert.doesNotMatch(insertedQuery, /ip|email|phone|cookie/i);
});

test("public reviews are listed with their aggregate rating", async () => {
  const originalQuery = pool.query;
  pool.query = async (query) => query.includes("COUNT(*)")
    ? { rows: [{ count: 1, average: "5.00" }] }
    : { rows: [{ id: "1", reviewer_name: "Alex", rating: 5, review_text: "Loved it!", created_at: "2025-01-01T00:00:00.000Z" }] };

  try {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/reviews`);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        reviews: [{
          id: "1",
          name: "Alex",
          rating: 5,
          review: "Loved it!",
          createdAt: "2025-01-01T00:00:00.000Z",
        }],
        count: 1,
        average: 5,
      });
    });
  } finally {
    pool.query = originalQuery;
  }
});

test("valid public reviews are saved and immediately returned", async () => {
  const originalQuery = pool.query;
  let insertedValues;
  pool.query = async (_query, values) => {
    insertedValues = values;
    return { rows: [{
      id: "7",
      reviewer_name: "Anonymous",
      rating: 4,
      review_text: "Really tasty",
      created_at: "2025-01-01T00:00:00.000Z",
    }] };
  };

  try {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "", rating: 4, review: "Really tasty" }),
      });
      assert.equal(response.status, 201);
      assert.deepEqual(await response.json(), {
        review: {
          id: "7",
          name: "Anonymous",
          rating: 4,
          review: "Really tasty",
          createdAt: "2025-01-01T00:00:00.000Z",
        },
      });
    });
  } finally {
    pool.query = originalQuery;
  }

  assert.deepEqual(insertedValues, ["Anonymous", 4, "Really tasty"]);
});

test("invalid public reviews are rejected before reaching the database", async () => {
  const originalQuery = pool.query;
  pool.query = async () => {
    throw new Error("Database should not be queried for invalid reviews.");
  };

  try {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating: 0, review: "Bad rating" }),
      });
      assert.equal(response.status, 400);
      assert.match((await response.json()).error, /1 to 5/i);
    });
  } finally {
    pool.query = originalQuery;
  }
});
