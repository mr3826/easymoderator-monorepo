import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ChevronRight, Upload, Loader2, Plus, Edit2, Trash2, X } from "lucide-react";
import { useTranslation } from 'react-i18next';
import { apiClient } from "@/api";

interface Category {
  id: string;
  name: string;
  description?: string;
  parent_category_id?: string;
  image?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  subcategories?: Category[];
  subcategoryCount?: number;
}

interface Subcategory {
  id?: string;
  name: string;
  image?: string;
  description?: string;
}

export default function CategoryDetails() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { categoryId } = useParams();

  const isCreateMode = !categoryId;

  const [categoryName, setCategoryName] = useState("");
  const [description, setDescription] = useState("");
  const [categoryImage, setCategoryImage] = useState("");
  const [subcategories, setSubcategories] = useState<Subcategory[]>([]);
  const [showSubcategoryModal, setShowSubcategoryModal] = useState(false);
  const [editingSubcategory, setEditingSubcategory] = useState<Subcategory | null>(null);
  const [editingSubcategoryIndex, setEditingSubcategoryIndex] = useState<number | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [subcategoryToDelete, setSubcategoryToDelete] = useState<{ subcategory: Subcategory; index: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load category data if in edit mode
  useEffect(() => {
    if (categoryId) {
      loadCategory();
    }
  }, [categoryId]);

  const loadCategory = async () => {
    try {
      setLoading(true);
      setError(null);
      const category = await apiClient.getCategory(categoryId!);
      setCategoryName(category.name);
      setDescription(category.description || "");
      setCategoryImage(category.image || "");
      // Load subcategories if they exist
      if (category.subcategories && category.subcategories.length > 0) {
        setSubcategories(category.subcategories.map(sub => ({
          id: sub.id,
          name: sub.name,
          description: sub.description,
          image: sub.image
        })));
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load category');
      console.error('Error loading category:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCategoryImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setCategoryImage(url);
    }
  };

  const handleAddSubcategory = () => {
    setEditingSubcategory(null);
    setEditingSubcategoryIndex(null);
    setShowSubcategoryModal(true);
  };

  const handleEditSubcategory = (subcategory: Subcategory, index: number) => {
    setEditingSubcategory(subcategory);
    setEditingSubcategoryIndex(index);
    setShowSubcategoryModal(true);
  };

  const handleSaveSubcategory = (subcategoryData: Subcategory) => {
    if (editingSubcategoryIndex !== null) {
      // Update existing subcategory
      const updated = [...subcategories];
      updated[editingSubcategoryIndex] = subcategoryData;
      setSubcategories(updated);
    } else {
      // Add new subcategory
      setSubcategories([...subcategories, subcategoryData]);
    }
    setShowSubcategoryModal(false);
    setEditingSubcategory(null);
    setEditingSubcategoryIndex(null);
  };

  const handleDeleteSubcategory = (subcategory: Subcategory, index: number) => {
    setSubcategoryToDelete({ subcategory, index });
    setShowDeleteModal(true);
  };

  const confirmDeleteSubcategory = () => {
    if (subcategoryToDelete !== null) {
      setSubcategories(subcategories.filter((_, i) => i !== subcategoryToDelete.index));
      setShowDeleteModal(false);
      setSubcategoryToDelete(null);
    }
  };

  const handleSave = async () => {
    if (!categoryName.trim()) {
      setError('Category name is required');
      return;
    }

    try {
      setSaving(true);
      setError(null);

      const categoryData = {
        name: categoryName.trim(),
        description: description.trim() || undefined,
        image: categoryImage || undefined,
        subcategories: subcategories.length > 0 ? subcategories : undefined,
      };

      if (isCreateMode) {
        await apiClient.createCategory(categoryData);
      } else {
        await apiClient.updateCategory(categoryId!, categoryData);
      }

      navigate("/app/categories");
    } catch (err: any) {
      const serverMessage = err?.response?.data?.error?.message;
      setError(serverMessage || err.message || `Failed to ${isCreateMode ? 'create' : 'update'} category`);
      console.error(`Error ${isCreateMode ? 'creating' : 'updating'} category:`, err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4 md:p-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-600 mb-6">
        <button onClick={() => navigate("/app/categories")} className="hover:text-gray-900">
          {t('categories.detail.breadcrumb')}
        </button>
        <ChevronRight className="w-4 h-4" />
        <span className="text-gray-900">
          {isCreateMode ? t('categories.detail.createTitle') : categoryName || t('categories.detail.loading')}
        </span>
      </div>

      {/* Page Header */}
      <div className="mb-6">
        <h1 className="text-2xl md:text-3xl font-bold text-gray-900">
          {isCreateMode ? t('categories.detail.createTitle') : t('categories.detail.detailTitle')}
        </h1>
        <p className="text-sm md:text-base text-gray-600 mt-1">
          {isCreateMode
            ? t('categories.detail.createDesc')
            : t('categories.detail.updateDesc')
          }
        </p>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-red-800">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
          <span className="ml-2 text-gray-600">{t('categories.detail.loading')}</span>
        </div>
) : (
        <>
          {/* Two Column Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Left Panel - Category Form */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-6">{t('categories.detail.infoSection')}</h2>

          <div className="space-y-6">
            {/* Category Image */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('categories.detail.categoryImage')}
              </label>
              <div className="border-2 border-dashed border-gray-300 rounded-lg overflow-hidden">
                {categoryImage ? (
                  <div className="relative group">
                    <img
                      src={categoryImage}
                      alt="Category"
                      className="w-full aspect-square object-cover"
                    />
                    <div className="absolute inset-0 bg-black bg-opacity-50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <label className="cursor-pointer px-4 py-2 bg-white text-gray-900 rounded-lg hover:bg-gray-100">
                        {t('categories.detail.changeImage')}
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleCategoryImageUpload}
                          className="hidden"
                        />
                      </label>
                    </div>
                  </div>
                ) : (
                  <label className="flex flex-col items-center justify-center aspect-square cursor-pointer hover:bg-gray-50">
                    <Upload className="w-8 h-8 text-gray-400 mb-2" />
                    <span className="text-sm text-gray-600">{t('categories.detail.uploadImage')}</span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleCategoryImageUpload}
                      className="hidden"
                    />
                  </label>
                )}
              </div>
              <p className="text-xs text-gray-500 mt-2">{t('categories.detail.imageHint')}</p>
            </div>

            {/* Category Name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('categories.detail.categoryName')} <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={categoryName}
                onChange={(e) => setCategoryName(e.target.value)}
                maxLength={50}
                placeholder={t('categories.detail.categoryNamePlaceholder')}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">{t('categories.detail.charCount', { count: categoryName.length })}</p>
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('categories.detail.shortDesc')}
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                placeholder={t('categories.detail.shortDescPlaceholder')}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Update Button */}
            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
            >
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  {isCreateMode ? t('categories.detail.creating') : t('categories.detail.updating')}
                </>
              ) : (
                isCreateMode ? t('categories.detail.createButton') : t('categories.detail.updateButton')
              )}
            </button>
          </div>
        </div>

        {/* Right Panel - Subcategories */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-gray-900">{t('categories.detail.subcategories')}</h2>
            <button
              onClick={handleAddSubcategory}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              <Plus className="w-4 h-4" />
              {t('categories.detail.addSubcategory')}
            </button>
          </div>

          {subcategories.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Plus className="w-8 h-8 text-gray-400" />
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">{t('categories.detail.noSubcategories')}</h3>
              <p className="text-gray-600 mb-6">{t('categories.detail.noSubcategoriesHint')}</p>
              <button
                onClick={handleAddSubcategory}
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                <Plus className="w-4 h-4" />
                {t('categories.detail.addFirstSubcategory')}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {subcategories.map((subcategory, index) => (
                <div
                  key={index}
                  className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg hover:bg-gray-50"
                >
                  {subcategory.image && (
                    <img
                      src={subcategory.image}
                      alt={subcategory.name}
                      className="w-12 h-12 rounded-lg object-cover border border-gray-200"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-gray-900">{subcategory.name}</div>
                    {subcategory.description && (
                      <div className="text-sm text-gray-500 truncate">{subcategory.description}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleEditSubcategory(subcategory, index)}
                      className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg"
                      title={t('common.edit')}
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDeleteSubcategory(subcategory, index)}
                      className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                      title={t('common.delete')}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
        </>
      )}

      {/* Subcategory Modal */}
      {showSubcategoryModal && (
        <SubcategoryModal
          subcategory={editingSubcategory}
          onClose={() => {
            setShowSubcategoryModal(false);
            setEditingSubcategory(null);
            setEditingSubcategoryIndex(null);
          }}
          onSave={handleSaveSubcategory}
        />
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && subcategoryToDelete && (
        <div className="fixed inset-0 bg-gray-900/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-2">{t('categories.detail.deleteSubcategoryTitle')}</h3>
            <p className="text-gray-600 mb-6">
              {t('categories.detail.deleteSubcategoryMsg', { name: subcategoryToDelete.subcategory.name })}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowDeleteModal(false);
                  setSubcategoryToDelete(null);
                }}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={confirmDeleteSubcategory}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
              >
                {t('common.delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Subcategory Modal Component
function SubcategoryModal({
  subcategory,
  onClose,
  onSave
}: {
  subcategory: Subcategory | null;
  onClose: () => void;
  onSave: (data: Subcategory) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(subcategory?.name || "");
  const [description, setDescription] = useState(subcategory?.description || "");
  const [image, setImage] = useState(subcategory?.image || "");

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImage(URL.createObjectURL(file));
    }
  };

  const handleSubmit = () => {
    if (!name.trim()) return;

    const data: Subcategory = {
      name: name.trim(),
      description: description.trim() || undefined,
      image: image || undefined,
    };

    // Preserve ID if editing existing subcategory
    if (subcategory?.id) {
      data.id = subcategory.id;
    }

    onSave(data);
  };

  return (
    <div className="fixed inset-0 bg-gray-900/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-900">
            {subcategory ? t('categories.detail.editSubcategory') : t('categories.detail.addSubcategory')}
          </h3>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Category Image */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t('categories.detail.subcategoryImageLabel')}
            </label>
            <div className="border-2 border-dashed border-gray-300 rounded-lg overflow-hidden max-w-xs">
              {image ? (
                <div className="relative group">
                  <img src={image} alt="Subcategory" className="w-full aspect-square object-cover" />
                  <div className="absolute inset-0 bg-black bg-opacity-50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <label className="cursor-pointer px-4 py-2 bg-white text-gray-900 rounded-lg hover:bg-gray-100">
                      Change
                      <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
                    </label>
                  </div>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center aspect-square cursor-pointer hover:bg-gray-50">
                  <Upload className="w-8 h-8 text-gray-400 mb-2" />
                  <span className="text-sm text-gray-600">Upload image</span>
                  <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
                </label>
              )}
            </div>
          </div>

          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t('categories.detail.subcategoryNameLabel')} <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('categories.detail.subcategoryNamePlaceholder')}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t('categories.detail.descriptionOptional')}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              placeholder={t('categories.detail.briefDescription')}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="border-t border-gray-200 px-6 py-4 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleSubmit}
            disabled={!name.trim()}
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {subcategory ? t('common.update') : t('common.add')}
          </button>
        </div>
      </div>
    </div>
  );
}


