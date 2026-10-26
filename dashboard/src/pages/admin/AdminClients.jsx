import ModalFrame from "../../components/layout/ModalFrame";
import { useEffect, useRef, useState } from "react";
import DashboardLayout from "../../components/layout/DashboardLayout";
import axiosInstance from "../../api/axiosInstance";
import getApiErrorMessage from "../../utils/getApiErrorMessage";
import useDataRefresh from "../../hooks/useDataRefresh";
import useAuth from "../../context/useAuth";
import PermissionNote from "../../components/layout/PermissionNote";

function AdminClients() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("manage_clients");
  const [showAddClient, setShowAddClient] = useState(false);

  const [clients, setClients] = useState([]);

  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  // The Add Client dialog covers the page, so its errors are shown inside it.
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const loadClients = async () => {
    try {
      setError("");
      const { data } = await axiosInstance.get("/clients");
      setClients(data.clients || []);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Unable to load clients."));
    }
  };

  useEffect(() => { void loadClients(); }, []);
  useDataRefresh(loadClients);

  const [formData, setFormData] = useState({
    clientName: "",
  });

  const handleChange = (event) => {
    const { name, value } = event.target;

    setFormData((previous) => ({
      ...previous,
      [name]: value,
    }));
  };

  const openAddClient = () => {
    setFormData({
      clientName: "",
    });

    setFormError("");
    setShowAddClient(true);
  };

  const closeAddClient = () => {
    setShowAddClient(false);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    // A second click before the first request returns would add the client twice.
    if (savingRef.current) return;

    if (!formData.clientName.trim()) {
      setFormError("Client name is required.");
      return;
    }

    savingRef.current = true;
    setSaving(true);
    setFormError("");
    try {
      await axiosInstance.post("/clients", { clientName: formData.clientName.trim() });
      setFormData({ clientName: "" });
      setShowAddClient(false);
      await loadClients();
    } catch (requestError) {
      setFormError(getApiErrorMessage(requestError, "Unable to add client."));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleDelete = async (clientId) => {
    const confirmed = window.confirm(
      "Are you sure you want to delete this client?"
    );

    if (!confirmed) {
      return;
    }

    try {
      await axiosInstance.delete(`/clients/${clientId}`);
      await loadClients();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Unable to deactivate client."));
    }
  };

  const handleEdit = async (client) => {
    const clientName = window.prompt("Client name", client.clientName)?.trim();
    if (!clientName || clientName === client.clientName) return;
    try {
      await axiosInstance.put(`/clients/${client._id}`, { clientName });
      await loadClients();
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "Unable to update client."));
    }
  };

  const filteredClients = clients.filter((client) => {
    const searchValue = search.trim().toLowerCase();

    if (!searchValue) {
      return true;
    }

    return client.clientName?.toLowerCase().includes(searchValue);
  });

  return (
    <DashboardLayout title="Clients">
      <section className="admin-card">
        {error && <p className="admin-error-box" role="alert">{error}</p>}

        <div className="employees-page-heading">
          <div>
            <p className="admin-eyebrow">
              CLIENT MANAGEMENT
            </p>

            <h2>Clients</h2>
            {!canManage && <PermissionNote permissions={["manage_clients"]} />}
          </div>

          {canManage && <button
            type="button"
            className="add-employee-button"
            onClick={openAddClient}
          >
            + Add Client
          </button>}
        </div>

        {/* SEARCH */}
        <div className="clients-toolbar">
          <div className="clients-search">
            <label htmlFor="client-search">
              Search:
            </label>

            <input
              id="client-search"
              type="search"
              value={search}
              onChange={(event) =>
                setSearch(event.target.value)
              }
              placeholder="Search client..."
            />
          </div>
        </div>

        {/* TABLE */}
        <div className="employees-table-wrapper">
          <table className="employees-table">

            <thead>
              <tr>
                <th>Client Name</th>
                {canManage && <th>Action</th>}
              </tr>
            </thead>

            <tbody>
              {filteredClients.length === 0 ? (
                <tr>
                  <td colSpan={canManage ? 2 : 1}>
                    {search
                      ? "No matching clients found."
                      : "No clients found."}
                  </td>
                </tr>
              ) : (
                filteredClients.map((client) => (
                  <tr key={client._id}>

                    <td>
                      {client.clientName || "-"}
                    </td>

                    {canManage && <td>
                      <div className="employee-actions">

                        <button
                          type="button"
                          className="edit-action-button"
                          onClick={() => handleEdit(client)}
                        >
                          Edit
                        </button>

                        <button
                          type="button"
                          className="delete-action-button"
                          onClick={() =>
                              handleDelete(client._id)
                          }
                        >
                          Delete
                        </button>

                      </div>
                    </td>}
                  </tr>
                ))
              )}
            </tbody>

          </table>
        </div>
      </section>

      {/* ADD CLIENT MODAL */}
      {showAddClient && (
        <ModalFrame onClose={closeAddClient} label="Clients details">

          <div className="employee-modal client-editor-modal">

            <div className="employee-modal-header">

              <div>
                <p className="admin-eyebrow">
                  CLIENT MANAGEMENT
                </p>

                <h2>Add Client</h2>
              </div>

              <button
                type="button"
                className="modal-close-button"
                onClick={closeAddClient}
              >
                ×
              </button>

            </div>

            <form
              className="employee-form"
              onSubmit={handleSubmit}
              aria-busy={saving}
            >
              {formError && <p className="admin-error-box" role="alert">{formError}</p>}

              <div>
                <label htmlFor="add-client-name">Client Name</label>

                <input
                  type="text"
                  id="add-client-name"
                  name="clientName"
                  value={formData.clientName}
                  onChange={handleChange}
                  required
                />
              </div>

              <div className="employee-form-actions">

                <button
                  type="button"
                  className="secondary-button"
                  onClick={closeAddClient}
                  disabled={saving}
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  className="primary-button"
                  disabled={saving}
                >
                  {saving ? "Adding..." : "Add Client"}
                </button>

              </div>

            </form>

          </div>
        </ModalFrame>
      )}
    </DashboardLayout>
  );
}

export default AdminClients;
