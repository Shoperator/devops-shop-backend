# devops-shop

Backend for the Shop application.

## Running locally

```bash
npm install
docker compose up -d     # PostgreSQL
npm run start:dev
```

## Tests

```bash
npm test         # unit tests
npm run test:e2e # integration tests, needs Docker (Testcontainers starts PostgreSQL)
```

The integration tests boot the whole application against a throwaway PostgreSQL
container, so they exercise real SQL, the real guards and the real validation
pipeline. Both suites run on every pull request.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `DB_HOST` / `DB_PORT` / `DB_USERNAME` / `DB_PASSWORD` / `DB_NAME` | `localhost` / `5432` / `shop` / `shop` / `shop` | PostgreSQL, provisioned per shop by the CNPG operator |
| `DB_SYNCHRONIZE` | `true` | Create the schema from the entities |
| `JWT_SECRET` | — | Signing key for access tokens |
| `JWT_EXPIRES_IN` | `1d` | Access token lifetime |
| `SHOP_ADMIN_USERNAME` / `SHOP_ADMIN_PASSWORD` / `SHOP_ADMIN_DISPLAY_NAME` | — | The shop owner's account, seeded on boot |
| `CORS_ORIGIN` | `*` | Origin of this shop's frontend |
| `PORT` | `3000` | HTTP port |

Registration only ever creates customers. The admin account is provisioned from
the environment ShopHub deploys the shop with, so a shop always has exactly one
owner and no request can grant itself the role.

## API

Everything is served under `/api/v1`.

### Auth

| Method | Path | Access | Description |
| --- | --- | --- | --- |
| `POST` | `/auth/register` | public | Create a customer account |
| `POST` | `/auth/login` | public | Exchange credentials for a bearer token |
| `GET` | `/auth/me` | signed in | The profile the token belongs to |

### Articles

| Method | Path | Access | Description |
| --- | --- | --- | --- |
| `GET` | `/articles` | public | Browse and search the catalogue |
| `GET` | `/articles/:id` | public | One article |
| `POST` | `/articles` | admin | Add an article |
| `PATCH` | `/articles/:id` | admin | Change any subset of its fields |
| `DELETE` | `/articles/:id` | admin | Remove it from the catalogue |

`GET /articles` accepts `?search=` (matched case-insensitively against the name
and the description) next to the pagination parameters below.

Deleting an article never rewrites order history: an order stores its own copy
of the article name and unit price in its `items`, so past orders keep reading
the way they were paid.

### Orders

| Method | Path | Access | Description |
| --- | --- | --- | --- |
| `POST` | `/orders` | customer | Checkout: turn a basket into an order |
| `GET` | `/orders/mine` | customer | The signed-in customer's own orders |
| `GET` | `/orders` | admin | Every order placed in this shop |
| `GET` | `/orders/:id` | admin | One order |

`GET /orders` accepts `?status=PENDING|PAID|CANCELLED|FAILED`.

Checkout takes article ids and quantities only:

```json
{ "items": [{ "articleId": "…", "quantity": 2 }] }
```

The name and the price come from the shop's own catalogue, never from the
request, so a client cannot name its own price. They are copied into the order,
so repricing or deleting an article afterwards leaves past orders unchanged.

Reserving the stock and writing the order share one transaction, and each
reservation is a single conditional statement (`… WHERE quantity >= :n`) rather
than a read followed by a write. Two customers buying the last piece at the same
moment therefore cannot both win it, however many replicas are running, and a
basket whose second article has run out leaves the first one back on the shelf.
Insufficient stock answers `409`, an article that no longer exists `404`.

**Payment is not implemented yet.** An order is created with status `PENDING`
and no transaction hash; settling it against a wallet on-chain is a separate
piece of work.

### Releasing stock

Checkout reserves stock before the money has moved, so an order whose payment
never settles would hold those articles.
`OrdersService.markPaymentFailed(orderId)` is the release: it moves the order
`PENDING → FAILED` and adds every line's pieces back to the catalogue, in one
transaction. It has no HTTP route — it is not a customer or admin action but the
call the blockchain payment integration makes when a payment is rejected, times
out, or comes back short.

### Pagination

Every list endpoint is paginated

Request: `?page=1&limit=20`, with `limit` capped at 100.

Response:

```json
{ "items": [], "total": 0, "page": 1, "limit": 20, "totalPages": 0 }
```
