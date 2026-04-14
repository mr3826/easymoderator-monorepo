# Dashboard Module Tests

This document describes the test suite for the Dashboard module.

## Test Coverage

### Service Tests (`dashboard.service.test.js`)
- **getDashboardMetrics**
  - Returns cached data when available
  - Calculates metrics correctly from database
  - Handles null/undefined values gracefully
  - Calculates conversion rate correctly
  - Handles division by zero for conversion rate
  - Calculates weekly change percentage

- **getDashboardChart**
  - Returns cached chart data
  - Generates chart data with all days filled
  - Handles empty order data

- **getDashboardMetricsById**
  - Returns null for mismatched shopId
  - Returns combined metrics for matched shopId

### Analytics Tests (`dashboard.analytics.test.js`)
- **logEvent**
  - Creates analytics row if not exists
  - Increments total_messages for message events
  - Increments llm_calls for AI model events
  - Increments cache_hits for cache events
  - Increments keyword_matches for keyword events
  - Adds cost_estimate when provided
  - Invalidates cache after logging
  - Uses current date when timestamp not provided

- **logMetric**
  - Creates analytics row if not exists
  - Invalidates cache after logging

- **getDashboardAnalytics**
  - Returns aggregated totals
  - Handles null values
  - Handles empty results
  - Queries with correct shop filter

### Controller Tests (`dashboard.controller.test.js`)
- **getDashboardMetricsRest**
  - Returns 200 with metrics data
  - Uses default period of 30
  - Uses specified period from query
  - Calls next with error on failure

- **getDashboardMetricsById**
  - Returns 200 with metrics when found
  - Returns 404 when metrics not found

- **getDashboardChart**
  - Returns 200 with chart data
  - Passes period to service

- **logAnalyticsEvent**
  - Returns 201 with event_id
  - Passes payload to analytics service

- **logAnalyticsMetric**
  - Returns 201 when recorded

- **getAnalyticsDashboard**
  - Returns aggregated analytics data
  - Includes placeholder metrics

- **getTodayQueue**
  - Returns queue counts
  - Maps at-risk orders correctly

- **Legacy getDashboardMetrics**
  - Works for backward compatibility

## Running Tests

```bash
# Run all dashboard tests
npm test -- src/modules/dashboard/__tests__

# Run specific test file
npm test -- src/modules/dashboard/__tests__/dashboard.service.test.js
npm test -- src/modules/dashboard/__tests__/dashboard.analytics.test.js
npm test -- src/modules/dashboard/__tests__/dashboard.controller.test.js

# Run with coverage
npm test -- src/modules/dashboard/__tests__ --coverage

# Run with verbose output
npm test -- src/modules/dashboard/__tests__ --verbose
```

## Test Configuration

Tests use Jest with the following mocks:
- **Entities**: Order, Product, Channel, Conversation, Analytics
- **Services**: cacheService
- **Dependencies**: dashboardService, dashboardAnalytics

All database operations are mocked to ensure fast, isolated tests.
