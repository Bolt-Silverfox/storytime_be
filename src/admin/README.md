# Admin Dashboard API

This module provides comprehensive administrative functionality for managing the StoryTime application.

## Authentication

All admin endpoints are protected by:
1. **AuthSessionGuard** - Validates JWT token
2. **AdminGuard** - Ensures user has admin role

Use the `@Admin()` decorator on controllers or routes to apply both guards automatically.

## API Endpoints

### Dashboard & Analytics

#### Get Dashboard Statistics
```http
GET /admin/dashboard/stats
```
Returns comprehensive platform statistics including user counts, story counts, and activity metrics.

**Response:**
```json
{
  "totalUsers": 1250,
  "totalParents": 850,
  "totalKids": 1500,
  "totalAdmins": 5,
  "totalStories": 450,
  "totalCategories": 12,
  "totalThemes": 25,
  "activeUsers24h": 120,
  "activeUsers7d": 450,
  "newUsersToday": 15,
  "newUsersThisWeek": 85,
  "newUsersThisMonth": 320,
  "totalStoryViews": 5600,
  "totalFavorites": 2300
}
```

#### Get User Growth
```http
GET /admin/dashboard/user-growth?startDate=2024-01-01&endDate=2024-12-31
```
Returns daily user growth data for the specified date range.

**Query Parameters:**
- `startDate` (optional): Start date (ISO format)
- `endDate` (optional): End date (ISO format)

**Response:**
```json
[
  {
    "date": "2024-01-01",
    "newUsers": 12,
    "totalUsers": 1000
  },
  ...
]
```

#### Get Story Statistics
```http
GET /admin/dashboard/story-stats
```
Returns detailed statistics about stories on the platform.

#### Get Content Breakdown
```http
GET /admin/dashboard/content-breakdown
```
Returns content categorized by language, age group, category, and theme.

#### Get System Health
```http
GET /admin/dashboard/system-health
```
Returns system health metrics including database status, uptime, and memory usage.

#### Get Recent Activity
```http
GET /admin/dashboard/recent-activity?limit=50
```
Returns recent user activity logs.

**Query Parameters:**
- `limit` (optional, default: 50): Number of activities to return

---

### User Management

#### List All Users
```http
GET /admin/users?page=1&limit=10&sortBy=createdAt&sortOrder=desc&search=john&role=parent
```

**Query Parameters:**
- `page` (optional, default: 1): Page number
- `limit` (optional, default: 10): Items per page
- `sortBy` (optional, default: 'createdAt'): Sort field
- `sortOrder` (optional, default: 'desc'): Sort order ('asc' or 'desc')
- `search` (optional): Search by email or name
- `role` (optional): Filter by role ('admin', 'parent', 'kid')
- `isEmailVerified` (optional): Filter by email verification status
- `isDeleted` (optional): Filter by deletion status
- `createdAfter` (optional): Filter users created after this date
- `createdBefore` (optional): Filter users created before this date

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "email": "user@example.com",
      "name": "John Doe",
      "title": "Mr",
      "role": "parent",
      "isEmailVerified": true,
      "isDeleted": false,
      "createdAt": "2024-01-01T00:00:00Z",
      "updatedAt": "2024-01-01T00:00:00Z",
      "_count": {
        "kids": 2,
        "auth": 5
      }
    }
  ],
  "meta": {
    "total": 1250,
    "page": 1,
    "limit": 10,
    "totalPages": 125
  }
}
```

#### Get User by ID
```http
GET /admin/users/:userId
```

Returns detailed information about a specific user including profile and kids.

#### Create Admin User
```http
POST /admin/users/admin
```

**Request Body:**
```json
{
  "email": "admin@example.com",
  "password": "SecurePassword123",
  "name": "Admin Name",
  "title": "Administrator"
}
```

#### Update User
```http
PUT /admin/users/:userId
```

**Request Body:**
```json
{
  "name": "Updated Name",
  "title": "Mr",
  "role": "admin",
  "email": "newemail@example.com"
}
```

#### Delete User
```http
DELETE /admin/users/:userId?permanent=false
```

**Query Parameters:**
- `permanent` (optional, default: false): If 'true', permanently deletes the user

Soft deletes a user by default (sets `isDeleted: true`). Use `permanent=true` for hard delete.

#### Restore User
```http
PATCH /admin/users/:userId/restore
```

Restores a soft-deleted user.

#### Bulk User Actions
```http
POST /admin/users/bulk-action
```

**Request Body:**
```json
{
  "userIds": ["uuid1", "uuid2", "uuid3"],
  "action": "delete"
}
```

**Actions:**
- `delete`: Soft delete multiple users
- `restore`: Restore multiple users
- `verify`: Verify email for multiple users

---

### Story Management

#### List All Stories
```http
GET /admin/stories?page=1&limit=10&search=adventure&recommended=true
```

**Query Parameters:**
- `page` (optional, default: 1): Page number
- `limit` (optional, default: 10): Items per page
- `sortBy` (optional, default: 'createdAt'): Sort field
- `sortOrder` (optional, default: 'desc'): Sort order
- `search` (optional): Search by title or description
- `recommended` (optional): Filter by recommended status
- `aiGenerated` (optional): Filter by AI generation status
- `isDeleted` (optional): Filter by deletion status
- `language` (optional): Filter by language
- `minAge` (optional): Filter by minimum age
- `maxAge` (optional): Filter by maximum age

#### Get Story by ID
```http
GET /admin/stories/:storyId
```

Returns detailed information about a story including images, categories, themes, and branches.

#### Toggle Story Recommendation
```http
PATCH /admin/stories/:storyId/recommend
```

Toggles the `recommended` status of a story.

#### Delete Story
```http
DELETE /admin/stories/:storyId?permanent=false
```

**Query Parameters:**
- `permanent` (optional, default: false): If 'true', permanently deletes the story

---

## Usage Example

### Using the Admin Decorator

```typescript
import { Controller, Get } from '@nestjs/common';
import { Admin } from './admin/decorators/admin.decorator';

@Controller('my-admin-routes')
@Admin() // Protects all routes in this controller
export class MyAdminController {
  
  @Get('stats')
  getStats() {
    // Only accessible by authenticated admin users
    return { message: 'Admin stats' };
  }
}
```

### Or on individual routes:

```typescript
@Controller('routes')
export class MyController {
  
  @Get('public')
  publicRoute() {
    // Anyone can access
  }
  
  @Get('admin-only')
  @Admin() // Only this route is protected
  adminOnlyRoute() {
    // Only admins can access
  }
}
```

## Admin User Creation

To create the first admin user, you can either:

1. **Via API** (if you have an existing admin token):
```bash
curl -X POST http://localhost:3500/admin/users/admin \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "password": "SecurePassword123",
    "name": "Super Admin"
  }'
```

2. **Via Database** (for the first admin):
```sql
-- Hash your password first using bcrypt with 10 rounds
-- Example: $2b$10$... 

INSERT INTO users (id, email, "passwordHash", name, role, "isEmailVerified", "createdAt", "updatedAt")
VALUES (
  gen_random_uuid(),
  'admin@storytime.com',
  '$2b$10$YOUR_HASHED_PASSWORD_HERE',
  'System Admin',
  'admin',
  true,
  NOW(),
  NOW()
);
```

## Error Responses

All endpoints return standard error responses:

```json
{
  "statusCode": 404,
  "message": "User with ID xyz not found",
  "error": "Not Found"
}
```

Common status codes:
- `400` - Bad Request (validation errors)
- `401` - Unauthorized (no/invalid token)
- `403` - Forbidden (not an admin)
- `404` - Not Found
- `409` - Conflict (e.g., email already exists)
- `500` - Internal Server Error

## Module Structure

```
src/admin/
├── decorators/
│   └── admin.decorator.ts       # @Admin() decorator
├── dto/
│   ├── admin-filters.dto.ts     # Query filters & pagination
│   ├── admin-responses.dto.ts   # Response DTOs
│   └── user-management.dto.ts   # User management DTOs
├── guards/                       # (Empty - guards are in auth module)
├── admin.controller.ts           # All admin endpoints
├── admin.service.ts              # Business logic
└── admin.module.ts               # Module definition
```

## Dependencies

This module depends on:
- **AuthModule**: For authentication guards (`AuthSessionGuard`, `AdminGuard`)
- **PrismaModule**: For database access
- **bcrypt**: For password hashing

## Security Notes

1. All admin routes require a valid JWT token with admin role
2. The `@Admin()` decorator automatically applies both authentication and authorization
3. Passwords are hashed using bcrypt with 10 rounds
4. Soft deletes are used by default to maintain data integrity
5. Email uniqueness is enforced at the database level

## Future Enhancements

Potential additions:
- Audit logging for all admin actions
- Export functionality (CSV, JSON)
- Advanced analytics and reporting
- Role-based permissions (super admin, content admin, etc.)
- Bulk content moderation tools
- System configuration management
- Email template management
