import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppLayout } from "@/components/AppLayout";
import Dashboard from "./pages/Dashboard";
import Lancamentos from "./pages/Lancamentos";
import NovoLancamento from "./pages/NovoLancamento";
import TabelaValores from "./pages/TabelaValores";
import CadastroCooperado from "./pages/CadastroCooperado";
import CadastroCliente from "./pages/CadastroCliente";
import Relatorios from "./pages/Relatorios";
import Fechamento from "./pages/Fechamento";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<ProtectedRoute><AppLayout><Dashboard /></AppLayout></ProtectedRoute>} />
            <Route path="/cadastros/cooperados" element={<ProtectedRoute><AppLayout><CadastroCooperado /></AppLayout></ProtectedRoute>} />
            <Route path="/cadastros/clientes" element={<ProtectedRoute><AppLayout><CadastroCliente /></AppLayout></ProtectedRoute>} />
            <Route path="/financeiro/lancamentos" element={
              <ProtectedRoute requireFinanceiro><AppLayout><Lancamentos /></AppLayout></ProtectedRoute>
            } />
            <Route path="/financeiro/lancamentos/novo" element={
              <ProtectedRoute requireFinanceiro><AppLayout><NovoLancamento /></AppLayout></ProtectedRoute>
            } />
            <Route path="/financeiro/tabela-valores" element={
              <ProtectedRoute requireFinanceiro><AppLayout><TabelaValores /></AppLayout></ProtectedRoute>
            } />
            <Route path="/financeiro/relatorios" element={
              <ProtectedRoute requireFinanceiro><AppLayout><Relatorios /></AppLayout></ProtectedRoute>
            } />
            <Route path="/financeiro/fechamento" element={
              <ProtectedRoute requireFinanceiro><AppLayout><Fechamento /></AppLayout></ProtectedRoute>
            } />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
