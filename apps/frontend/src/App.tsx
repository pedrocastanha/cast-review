import { Navigate, Route, BrowserRouter, Routes } from 'react-router-dom';
import { GuestRoute } from './components/layout/GuestRoute';
import { RepositoryLayout } from './components/repos/RepositoryLayout';
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
import { RepoRunsPage } from './pages/RepoRunsPage';
import { ReposPage } from './pages/ReposPage';
import { SettingsPage } from './pages/SettingsPage';
import { BenchmarksPage } from './pages/BenchmarksPage';
import { ChatPage } from './pages/ChatPage';
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
            element={<ProtectedRoute><Layout wide><ProjectGraphPage /></Layout></ProtectedRoute>}
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
                <Layout wide>
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
                <Layout wide>
                  <RepositoryLayout>
                    <PullRequestsPage />
                  </RepositoryLayout>
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/repos/:owner/:repo/runs"
            element={
              <ProtectedRoute>
                <Layout wide>
                  <RepositoryLayout>
                    <RepoRunsPage />
                  </RepositoryLayout>
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/repos/:owner/:repo/pulls/:pullNumber"
            element={
              <ProtectedRoute>
                <Layout wide>
                  <PullRequestReviewPage />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/repos/:owner/:repo/analyses/:analysisId"
            element={
              <ProtectedRoute>
                <Layout wide>
                  <AnalysisRecordPage />
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/chat"
            element={<ProtectedRoute><Layout fill><ChatPage /></Layout></ProtectedRoute>}
          />
          <Route
            path="/repos/:owner/:repo/graph"
            element={
              <ProtectedRoute>
                <Layout wide>
                  <RepositoryLayout>
                    <RepoGraphPage />
                  </RepositoryLayout>
                </Layout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/repos/:owner/:repo/pulls/:pullNumber/run"
            element={
              <ProtectedRoute>
                <Layout wide>
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
