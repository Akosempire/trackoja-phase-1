import { Navigate, Route, Routes } from 'react-router-dom';
import { ProtectedRoute, GuestRoute, OnboardingRoute, PlatformAdminRoute } from './routes/ProtectedRoute';
import { AppLayout } from './components/AppLayout';
import WelcomePage from './pages/WelcomePage';
import LoginPage from './pages/auth/LoginPage';
import SignUpPage from './pages/auth/SignUpPage';
import ForgotPasswordPage from './pages/auth/ForgotPasswordPage';
import ResetPasswordPage from './pages/auth/ResetPasswordPage';
import VerifyEmailPage from './pages/auth/VerifyEmailPage';
import OnboardingPage from './pages/onboarding/OnboardingPage';
import DashboardPage from './pages/DashboardPage';
import ProductsPage from './pages/inventory/ProductsPage';
import ProductFormPage from './pages/inventory/ProductFormPage';
import BulkImportPage from './pages/inventory/BulkImportPage';
import CategoriesPage from './pages/inventory/CategoriesPage';
import StockAdjustmentPage from './pages/inventory/StockAdjustmentPage';
import CheckoutPage from './pages/sales/CheckoutPage';
import ReceiptPage from './pages/sales/ReceiptPage';
import SalesHistoryPage from './pages/sales/SalesHistoryPage';
import CustomersListPage from './pages/customers/CustomersListPage';
import CustomerFormPage from './pages/customers/CustomerFormPage';
import CustomerDetailPage from './pages/customers/CustomerDetailPage';
import PaymentsPage from './pages/payments/PaymentsPage';
import DevicesPage from './pages/devices/DevicesPage';
import DeviceDetailPage from './pages/devices/DeviceDetailPage';
import StaffPage from './pages/staff/StaffPage';
import ReportsPage from './pages/reports/ReportsPage';
import BillingPage from './pages/billing/BillingPage';
import PlatformDashboardPage from './pages/platform/PlatformDashboardPage';

function RootRedirect() {
  const seenWelcome = localStorage.getItem('tk_welcome_seen');
  return <Navigate to={seenWelcome ? '/login' : '/welcome'} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route element={<GuestRoute />}>
        <Route path="/" element={<RootRedirect />} />
        <Route path="/welcome" element={<WelcomePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignUpPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      </Route>

      {/* Reachable while authenticated or not, since they manage the user's session directly */}
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />

      <Route element={<OnboardingRoute />}>
        <Route path="/onboarding" element={<OnboardingPage />} />
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
          <Route path="/sales" element={<SalesHistoryPage />} />
          <Route path="/sales/checkout" element={<CheckoutPage />} />
          <Route path="/sales/:saleId" element={<ReceiptPage />} />
          <Route path="/customers" element={<CustomersListPage />} />
          <Route path="/customers/new" element={<CustomerFormPage />} />
          <Route path="/customers/:customerId" element={<CustomerDetailPage />} />
          <Route path="/customers/:customerId/edit" element={<CustomerFormPage />} />
          <Route path="/payments" element={<PaymentsPage />} />
          <Route path="/devices" element={<DevicesPage />} />
          <Route path="/devices/:deviceId" element={<DeviceDetailPage />} />
          <Route path="/staff" element={<StaffPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/billing" element={<BillingPage />} />
          <Route element={<PlatformAdminRoute />}>
            <Route path="/platform" element={<PlatformDashboardPage />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
