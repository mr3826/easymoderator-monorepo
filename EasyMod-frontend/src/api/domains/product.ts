/**
 * Product & Category API Domain
 */

import { httpClient } from '@/shared/lib/http/client';
import type { ApiResponse } from '../types/common';
import type {
  Product,
  Category,
  ProductExtractResult,
  ProductUploadPayload,
} from '../types/product';
import type { AxiosResponse } from 'axios';

/**
 * Get all products with optional filtering
 * @param params - Optional query parameters for filtering, pagination, and sorting
 * @returns Promise resolving to array of products
 * @throws {Error} When product retrieval fails
 * @example
 * ```typescript
 * const products = await getProducts({ category: 'electronics', page: 1, limit: 10 });
 * ```
 */
export async function getProducts(params?: Record<string, unknown>): Promise<Product[]> {
  const response: AxiosResponse<ApiResponse<Product[]>> = await httpClient.get('/api/product', {
    params,
  });
  return response.data.data;
}

/**
 * Get single product by ID
 * @param productId - Unique identifier of the product to retrieve
 * @returns Promise resolving to product object
 * @throws {Error} When product not found or retrieval fails
 * @example
 * ```typescript
 * const product = await getProduct('prod123');
 * console.log(product.name);
 * ```
 */
export async function getProduct(productId: string): Promise<Product> {
  const response: AxiosResponse<ApiResponse<Product>> = await httpClient.get(
    `/api/product/${productId}`
  );
  return response.data.data;
}

/**
 * Create new product
 * @param product - Product data without id, createdAt, and updatedAt
 * @returns Promise resolving to created product object
 * @throws {Error} When product creation fails due to validation or network issues
 * @example
 * ```typescript
 * const newProduct = await createProduct({ 
 *   name: 'New Product', 
 *   price: 99.99, 
 *   category_id: 'cat123' 
 * });
 * ```
 */
export async function createProduct(
  product: Omit<Product, 'id' | 'createdAt' | 'updatedAt'>
): Promise<Product> {
  const response: AxiosResponse<ApiResponse<Product>> = await httpClient.post('/api/product', product);
  return response.data.data;
}

/**
 * Update existing product
 * @param productId - ID of product to update
 * @param product - Partial product data with fields to update
 * @returns Promise resolving to updated product object
 * @throws {Error} When product update fails due to invalid ID or permissions
 * @example
 * ```typescript
 * const updated = await updateProduct('prod123', { price: 149.99 });
 * ```
 */
export async function updateProduct(
  productId: string,
  product: Partial<Product>
): Promise<Product> {
  const response: AxiosResponse<ApiResponse<Product>> = await httpClient.patch(
    `/api/product/${productId}`,
    product
  );
  return response.data.data;
}

/**
 * Delete product by ID
 * @param productId - ID of product to delete
 * @returns Promise that resolves when deletion completes
 * @throws {Error} When product deletion fails due to invalid ID or permissions
 * @example
 * ```typescript
 * await deleteProduct('prod123');
 * // Product deleted successfully
 * ```
 */
export async function deleteProduct(productId: string): Promise<void> {
  await httpClient.delete(`/api/product/${productId}`);
}

/**
 * Extract products from uploaded file using AI
 * @param payload - Upload payload containing file and format information
 * @returns Promise resolving to extracted product data with validation results
 * @throws {Error} When file extraction fails due to invalid format or processing errors
 * @example
 * ```typescript
 * const result = await extractProductsFromUpload({ 
 *   file: csvFile, 
 *   format: 'csv' 
 * });
 * console.log('Extracted products:', result.products.length);
 * ```
 */
export async function extractProductsFromUpload(
  payload: ProductUploadPayload
): Promise<ProductExtractResult> {
  const response: AxiosResponse<ApiResponse<ProductExtractResult>> = await httpClient.post(
    '/api/product/ai-extract',
    payload
  );
  return response.data.data;
}

/**
 * Get all product categories
 * @returns Promise resolving to array of categories
 * @throws {Error} When category retrieval fails
 * @example
 * ```typescript
 * const categories = await getCategories();
 * console.log('Available categories:', categories.length);
 * ```
 */
export async function getCategories(): Promise<Category[]> {
  const response: AxiosResponse<ApiResponse<Category[]>> = await httpClient.get('/api/category');
  return response.data.data;
}

/**
 * Get single category by ID
 * @param categoryId - Unique identifier of category to retrieve
 * @returns Promise resolving to category object
 * @throws {Error} When category not found or retrieval fails
 * @example
 * ```typescript
 * const category = await getCategory('cat123');
 * console.log(category.name);
 * ```
 */
export async function getCategory(categoryId: string): Promise<Category> {
  const response: AxiosResponse<ApiResponse<Category>> = await httpClient.get(
    `/api/category/${categoryId}`
  );
  return response.data.data;
}

/**
 * Create new product category
 * @param category - Category data without id, createdAt, and updatedAt
 * @returns Promise resolving to created category object
 * @throws {Error} When category creation fails due to validation or network issues
 * @example
 * ```typescript
 * const newCategory = await createCategory({ 
 *   name: 'Electronics', 
 *   description: 'Electronic devices' 
 * });
 * ```
 */
export async function createCategory(
  category: Omit<Category, 'id' | 'created_at' | 'updated_at'>
): Promise<Category> {
  const response: AxiosResponse<ApiResponse<Category>> = await httpClient.post('/api/category', category);
  return response.data.data;
}

/**
 * Update existing category
 * @param categoryId - ID of category to update
 * @param category - Partial category data with fields to update
 * @returns Promise resolving to updated category object
 * @throws {Error} When category update fails due to invalid ID or permissions
 * @example
 * ```typescript
 * const updated = await updateCategory('cat123', { name: 'Updated Name' });
 * ```
 */
export async function updateCategory(
  categoryId: string,
  category: Partial<Category>
): Promise<Category> {
  const response: AxiosResponse<ApiResponse<Category>> = await httpClient.patch(
    `/api/category/${categoryId}`,
    category
  );
  return response.data.data;
}

/**
 * Delete category by ID
 * @param categoryId - ID of category to delete
 * @returns Promise that resolves when deletion completes
 * @throws {Error} When category deletion fails due to invalid ID or permissions
 * @example
 * ```typescript
 * await deleteCategory('cat123');
 * // Category deleted successfully
 * ```
 */
export async function deleteCategory(categoryId: string): Promise<void> {
  await httpClient.delete(`/api/category/${categoryId}`);
}

/**
 * Get subcategory details including parent category
 * @param categoryId - ID of parent category
 * @param subcategoryId - ID of subcategory to retrieve
 * @returns Promise resolving to subcategory object with parent data
 * @throws {Error} When subcategory retrieval fails
 * @example
 * ```typescript
 * const subcategory = await getSubcategoryDetails('cat123', 'sub456');
 * console.log('Subcategory:', subcategory.name);
 * ```
 */
export async function getSubcategoryDetails(
  categoryId: string,
  subcategoryId: string
): Promise<Category> {
  const response: AxiosResponse<ApiResponse<Category>> = await httpClient.get(
    `/api/category/${categoryId}/subcategory/${subcategoryId}`
  );
  return response.data.data;
}


