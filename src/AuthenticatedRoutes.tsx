import { lazy } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'

const AppShell = lazy(() => import('./components/AppShell').then((m) => ({ default: m.AppShell })))
const HomePage = lazy(() => import('./pages/HomePage').then((m) => ({ default: m.HomePage })))
const QueryPage = lazy(() => import('./pages/QueryPage').then((m) => ({ default: m.QueryPage })))
const FinancialQueryPage = lazy(() =>
  import('./pages/FinancialQueryPage').then((m) => ({ default: m.FinancialQueryPage })),
)
const RecordPreview = lazy(() => import('./pages/RecordPreview').then((m) => ({ default: m.RecordPreview })))
const FinancialRecordPreview = lazy(() =>
  import('./pages/FinancialRecordPreview').then((m) => ({ default: m.FinancialRecordPreview })),
)
const InvoiceQueryStatsPage = lazy(() =>
  import('./pages/InvoiceQueryStatsPage').then((m) => ({ default: m.InvoiceQueryStatsPage })),
)
const FullInvoiceQueryPage = lazy(() =>
  import('./pages/FullInvoiceQueryPage').then((m) => ({ default: m.FullInvoiceQueryPage })),
)
const InvoiceRecordPreview = lazy(() =>
  import('./pages/InvoiceRecordPreview').then((m) => ({ default: m.InvoiceRecordPreview })),
)
const TaxPaymentCertQueryPage = lazy(() =>
  import('./pages/TaxPaymentCertQueryPage').then((m) => ({ default: m.TaxPaymentCertQueryPage })),
)
const TaxPaymentCertRecordPreview = lazy(() =>
  import('./pages/TaxPaymentCertRecordPreview').then((m) => ({ default: m.TaxPaymentCertRecordPreview })),
)

type Props = { email: string | null; onSignOut: () => void }

export default function AuthenticatedRoutes({ email, onSignOut }: Props) {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        <Route
          path="/"
          element={
            <AppShell userEmail={email} onSignOut={onSignOut} />
          }
        >
          <Route index element={<HomePage />} />
          <Route path="query" element={<QueryPage />} />
          <Route path="record/:id" element={<RecordPreview />} />
          <Route path="financial-query" element={<FinancialQueryPage />} />
          <Route path="financial-record/:id" element={<FinancialRecordPreview />} />
          <Route path="invoice-query/stats" element={<InvoiceQueryStatsPage />} />
          <Route path="invoice-query/full" element={<FullInvoiceQueryPage />} />
          <Route path="invoice-query/record/:id" element={<InvoiceRecordPreview />} />
          <Route path="tax-payment-cert/query" element={<TaxPaymentCertQueryPage />} />
          <Route path="tax-payment-cert/record/:id" element={<TaxPaymentCertRecordPreview />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
