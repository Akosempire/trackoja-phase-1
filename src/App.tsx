import { lazy, Suspense, type ComponentType } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthEntryRedirect, ProtectedRoute, GuestRoute, OnboardingRoute, PlatformAdminRoute, WorkspaceRoute } from './routes/ProtectedRoute';
import { AppLayout } from './components/AppLayout';
import { PageLoader } from './components/ui/PageLoader';
import LegalPlaceholderPage from './pages/landing/LegalPlaceholderPage';
import { PlatformProvider } from './components/platform/PlatformContext';
import { PlatformLayout } from './components/platform/PlatformLayout';

const pageModules = import.meta.glob<{ default: ComponentType }>([
  './pages/**/*.tsx',
  '!./pages/landing/LandingIcons.tsx',
  '!./pages/landing/LegalPlaceholderPage.tsx',
]);
const lazyPage = (path: string) => {
  const loader = pageModules[`${path}.tsx`];
  if (!loader) throw new Error(`Unknown page module: ${path}`);
  return lazy(loader);
};
const WelcomePage = lazyPage('./pages/WelcomePage');
const LoginPage = lazyPage('./pages/auth/LoginPage');
const SignUpPage = lazyPage('./pages/auth/SignUpPage');
const ForgotPasswordPage = lazyPage('./pages/auth/ForgotPasswordPage');
const ResetPasswordPage = lazyPage('./pages/auth/ResetPasswordPage');
const VerifyEmailPage = lazyPage('./pages/auth/VerifyEmailPage');
const AuthCallbackPage = lazyPage('./pages/auth/AuthCallbackPage');
const OnboardingPage = lazyPage('./pages/onboarding/OnboardingPage');
const DashboardPage = lazyPage('./pages/DashboardPage');
const ProductsPage = lazyPage('./pages/inventory/ProductsPage');
const ProductFormPage = lazyPage('./pages/inventory/ProductFormPage');
const BulkImportPage = lazyPage('./pages/inventory/BulkImportPage');
const CategoriesPage = lazyPage('./pages/inventory/CategoriesPage');
const StockAdjustmentPage = lazyPage('./pages/inventory/StockAdjustmentPage');
const StockLotsPage = lazyPage('./pages/inventory/StockLotsPage');
const CheckoutPage = lazyPage('./pages/sales/CheckoutPage');
const ReceiptPage = lazyPage('./pages/sales/ReceiptPage');
const SalesHubPage = lazyPage('./pages/sales/SalesHubPage');
const SalesHistoryPage = lazyPage('./pages/sales/SalesHistoryPage');
const CustomersListPage = lazyPage('./pages/customers/CustomersListPage');
const CustomerFormPage = lazyPage('./pages/customers/CustomerFormPage');
const CustomerDetailPage = lazyPage('./pages/customers/CustomerDetailPage');
const PaymentsPage = lazyPage('./pages/payments/PaymentsPage');
const ExpensesPage = lazyPage('./pages/expenses/ExpensesPage');
const JobsPage = lazyPage('./pages/jobs/JobsPage');
const DevicesPage = lazyPage('./pages/devices/DevicesPage');
const DeviceDetailPage = lazyPage('./pages/devices/DeviceDetailPage');
const StaffPage = lazyPage('./pages/staff/StaffPage');
const ReportsPage = lazyPage('./pages/reports/ReportsPage');
const BillingPage = lazyPage('./pages/billing/BillingPage');
const MorePage = lazyPage('./pages/MorePage');
const SettingsPage = lazyPage('./pages/SettingsPage');
const SupportPage = lazyPage('./pages/SupportPage');
const KitchenPage = lazyPage('./pages/restaurant/KitchenPage');
const ExpiryAlertsPage = lazyPage('./pages/pharmacy/ExpiryAlertsPage');
const LandingPage = lazyPage('./pages/landing/LandingPage');
const WorkspaceSelectionPage = lazyPage('./pages/WorkspaceSelectionPage');
const OverviewArea = lazyPage('./pages/platform/areas/OverviewArea');
const BusinessesArea = lazyPage('./pages/platform/areas/BusinessesArea');
const BusinessDetailArea = lazyPage('./pages/platform/areas/BusinessDetailArea');
const BillingArea = lazyPage('./pages/platform/areas/BillingArea');
const ActivationArea = lazyPage('./pages/platform/areas/ActivationArea');
const SupportArea = lazyPage('./pages/platform/areas/SupportArea');
const IntegrationsArea = lazyPage('./pages/platform/areas/IntegrationsArea');
const HealthArea = lazyPage('./pages/platform/areas/HealthArea');
const DeveloperArea = lazyPage('./pages/platform/areas/DeveloperArea');
const AuditArea = lazyPage('./pages/platform/areas/AuditArea');
const SettingsArea = lazyPage('./pages/platform/areas/SettingsArea');

/**
 * Public front door. The landing page replaced the old "/" -> /welcome redirect;
 * /welcome is still reachable on its own route.
 */
function LandingRoute() {
  // Supabase sends errors to the site root when the redirect URL isn't in the
  // allowed list. Forward the hash to /auth/callback so it's handled there.
  if (window.location.hash.includes('error=')) {
    return <Navigate to={`/auth/callback${window.location.hash}`} replace />;
  }
  return <LandingPage />;
}


export default function App() {
  return (
    <Suspense fallback={<PageLoader />}>
    <Routes>
      <Route element={<GuestRoute />}>
        <Route path="/" element={<LandingRoute />} />
        <Route path="/welcome" element={<WelcomePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignUpPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      </Route>

      {/* Reachable while authenticated or not, since they manage the user's session directly */}
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/auth/callback" element={<AuthCallbackPage />} />
      <Route path="/auth/continue" element={<AuthEntryRedirect />} />

      {/* Public legal pages linked from the landing page footer */}
      <Route
        path="/privacy"
        element={
          <LegalPlaceholderPage
            title="Privacy notice"
            summary="How TrackOja handles business and customer information."
          />
        }
      />
      <Route
        path="/terms"
        element={
          <LegalPlaceholderPage
            title="Terms of service"
            summary="The terms that apply when you use TrackOja."
          />
        }
      />

      <Route element={<OnboardingRoute />}>
        <Route path="/onboarding" element={<OnboardingPage />} />
      </Route>

      <Route element={<WorkspaceRoute />}>
        <Route path="/workspace" element={<WorkspaceSelectionPage />} />
      </Route>

      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/inventory/products" element={<ProductsPage />} />
          <Route path="/inventory/products/bulk-import" element={<BulkImportPage />} />
          <Route path="/inventory/products/new" element={<ProductFormPage />} />
          <Route path="/inventory/products/:productId" element={<ProductFormPage />} />
          <Route path="/inventory/categories" element={<CategoriesPage />} />
          <Route path="/inventory/stock" element={<StockAdjustmentPage />} />
          <Route path="/inventory/lots" element={<StockLotsPage />} />
          <Route path="/sales" element={<SalesHubPage />} />
          <Route path="/sales/history" element={<SalesHistoryPage />} />
          <Route path="/sales/checkout" element={<CheckoutPage />} />
          <Route path="/sales/:saleId" element={<ReceiptPage />} />
          <Route path="/customers" element={<CustomersListPage />} />
          <Route path="/customers/new" element={<CustomerFormPage />} />
          <Route path="/customers/:customerId" element={<CustomerDetailPage />} />
          <Route path="/customers/:customerId/edit" element={<CustomerFormPage />} />
          <Route path="/payments" element={<PaymentsPage />} />
          <Route path="/expenses" element={<ExpensesPage />} />
          <Route path="/jobs" element={<JobsPage />} />
          <Route path="/devices" element={<DevicesPage />} />
          <Route path="/devices/:deviceId" element={<DeviceDetailPage />} />
          <Route path="/staff" element={<StaffPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/billing" element={<BillingPage />} />
          <Route path="/more" element={<MorePage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/support" element={<SupportPage />} />
          <Route path="/kitchen" element={<KitchenPage />} />
          <Route path="/pharmacy/expiry" element={<ExpiryAlertsPage />} />
        </Route>

        {/* The platform console is a sibling of the merchant shell, not a child of
            it: a platform operator has no store, so the merchant sidebar, store
            switcher and bottom tabs must not render around these screens. */}
        <Route element={<PlatformAdminRoute />}>
          <Route
            path="/platform"
            element={
              <PlatformProvider>
                <PlatformLayout />
              </PlatformProvider>
            }
          >
            <Route index element={<OverviewArea />} />
            <Route path="businesses" element={<BusinessesArea />} />
            <Route path="businesses/:orgId" element={<BusinessDetailArea />} />
            {/* Activation is the last area still being implemented. It routes to
                an honest stand-in rather than a blank page or a mock-up, so the
                navigation can never dead-end. */}
            <Route path="billing" element={<BillingArea />} />
            <Route path="activation" element={<ActivationArea />} />
            <Route path="support" element={<SupportArea />} />
            <Route path="integrations" element={<IntegrationsArea />} />
            <Route path="health" element={<HealthArea />} />
            <Route path="developer" element={<DeveloperArea />} />
            <Route path="audit" element={<AuditArea />} />
            <Route path="settings" element={<SettingsArea />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
    </Suspense>
  );
}
