import { Navigate, Route, BrowserRouter, Routes } from 'react-router-dom';
import { GuestRoute } from './components/layout/GuestRoute';
import { Layout } from './components/layout/Layout';
import { ProtectedRoute } from './components/layout/ProtectedRoute';
import { AuthProvider } from './context/AuthContext';
import { AnalysisPage } from './pages/AnalysisPage';
import { AnalysisRecordPage } from './pages/AnalysisRecordPage';
import { LoginPage } from './pages/LoginPage';
import { PullRequestsPage } from './pages/PullRequestsPage';
import { PullRequestReviewPage } from './pages/PullRequestReviewPage';
import { RegisterPage } from './pages/RegisterPage';
import { RepoGraphPage } from './pages/RepoGraphPage';
import { ReposPage } from './pages/ReposPage';
import { SettingsPage } from './pages/SettingsPage';
import { BenchmarksPage } from './pages/BenchmarksPage';
import { ProjectFormPage } from './pages/ProjectFormPage';
import { ProjectGraphPage } from './pages/ProjectGraphPage';
import { ProjectsPage } from './pages/ProjectsPage';

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Navigate to="/projects" replace />} />

          <Route
            path="/login"
            element={
              <GuestRoute>
                <LoginPage />
              </GuestRoute>
            }
          />
          <Route
            path="/register"
            element={
              <GuestRoute>
                <RegisterPage />
              </GuestRoute>
            }
          />

          <Route
            path="/projects"
            element={<ProtectedRoute><Layout><ProjectsPage /></Layout></ProtectedRoute>}
          />
          <Route
            path="/projects/new"
            element={<ProtectedRoute><Layout><ProjectFormPage /></Layout></ProtectedRoute>}
          />
          <Route
            path="/projects/:id/edit"
            element={<ProtectedRoute><Layout><ProjectFormPage /></Layout></ProtectedRoute>}
          />
          <Route
            path="/projects/:id"
            element={<ProtectedRoute><Layout><ProjectGraphPage /></Layout></ProtectedRoute>}
          />
          <Route
            path="/repos"
            element={
              <ProtectedRoute>
                <Layout>
                  <ReposPage />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/benchmarks"
            element={
              <ProtectedRoute>
                <Layout>
                  <BenchmarksPage />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute>
                <Layout>
                  <SettingsPage />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/repos/:owner/:repo/pulls"
            element={
              <ProtectedRoute>
                <Layout>
                  <PullRequestsPage />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/repos/:owner/:repo/pulls/:pullNumber"
            element={
              <ProtectedRoute>
                <Layout>
                  <PullRequestReviewPage />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/repos/:owner/:repo/analyses/:analysisId"
            element={
              <ProtectedRoute>
                <Layout>
                  <AnalysisRecordPage />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/repos/:owner/:repo/graph"
            element={
              <ProtectedRoute>
                <Layout>
                  <RepoGraphPage />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/repos/:owner/:repo/pulls/:pullNumber/run"
            element={
              <ProtectedRoute>
                <Layout>
                  <AnalysisPage />
                </Layout>
              </ProtectedRoute>
            }
          />

          <Route path="*" element={<Navigate to="/projects" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
