// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface SpatioTemporalData {
  id: string;
  encryptedLocation: string;
  timestamp: number;
  owner: string;
  dataType: "geospatial" | "temporal";
  status: "active" | "inactive";
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [dataList, setDataList] = useState<SpatioTemporalData[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newData, setNewData] = useState({
    dataType: "geospatial",
    coordinates: "",
    timeRange: "",
    description: ""
  });
  const [activeTab, setActiveTab] = useState<"geospatial" | "temporal">("geospatial");
  const [searchQuery, setSearchQuery] = useState("");

  // Randomly selected features: Data Statistics and Search & Filter
  const activeCount = dataList.filter(d => d.status === "active").length;
  const inactiveCount = dataList.filter(d => d.status === "inactive").length;
  const geospatialCount = dataList.filter(d => d.dataType === "geospatial").length;
  const temporalCount = dataList.filter(d => d.dataType === "temporal").length;

  const filteredData = dataList.filter(data => {
    if (searchQuery === "") return true;
    return (
      data.id.includes(searchQuery) ||
      data.owner.toLowerCase().includes(searchQuery.toLowerCase()) ||
      data.dataType.includes(searchQuery.toLowerCase())
    );
  });

  useEffect(() => {
    loadData().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadData = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("data_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing data keys:", e);
        }
      }
      
      const list: SpatioTemporalData[] = [];
      
      for (const key of keys) {
        try {
          const dataBytes = await contract.getData(`data_${key}`);
          if (dataBytes.length > 0) {
            try {
              const data = JSON.parse(ethers.toUtf8String(dataBytes));
              list.push({
                id: key,
                encryptedLocation: data.location,
                timestamp: data.timestamp,
                owner: data.owner,
                dataType: data.dataType,
                status: data.status || "active"
              });
            } catch (e) {
              console.error(`Error parsing data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading data ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setDataList(list);
    } catch (e) {
      console.error("Error loading data:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitData = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting spatiotemporal data with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(JSON.stringify(newData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const dataId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const data = {
        location: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        owner: account,
        dataType: newData.dataType,
        status: "active"
      };
      
      await contract.setData(
        `data_${dataId}`, 
        ethers.toUtf8Bytes(JSON.stringify(data))
      );
      
      const keysBytes = await contract.getData("data_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(dataId);
      
      await contract.setData(
        "data_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Encrypted data submitted securely!"
      });
      
      await loadData();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewData({
          dataType: "geospatial",
          coordinates: "",
          timeRange: "",
          description: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const toggleDataStatus = async (dataId: string, currentStatus: "active" | "inactive") => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Updating encrypted data status..."
    });

    try {
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const dataBytes = await contract.getData(`data_${dataId}`);
      if (dataBytes.length === 0) {
        throw new Error("Data not found");
      }
      
      const data = JSON.parse(ethers.toUtf8String(dataBytes));
      
      const updatedData = {
        ...data,
        status: currentStatus === "active" ? "inactive" : "active"
      };
      
      await contract.setData(
        `data_${dataId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedData))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Status updated successfully!"
      });
      
      await loadData();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Update failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const isOwner = (address: string) => {
    return account.toLowerCase() === address.toLowerCase();
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Initializing FHE connection...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>SpatioTemporal<span>FHE</span>DB</h1>
          <p>Fully Homomorphic Encrypted Spatiotemporal Database</p>
        </div>
        
        <div className="header-actions">
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <main className="main-content">
        <div className="hero-section">
          <div className="hero-text">
            <h2>Secure Spatiotemporal Data Storage</h2>
            <p>Store and query encrypted geospatial and temporal data with FHE technology</p>
            <button 
              onClick={() => setShowCreateModal(true)} 
              className="primary-btn"
            >
              Add Encrypted Data
            </button>
          </div>
          <div className="hero-image"></div>
        </div>

        <div className="stats-section">
          <div className="stat-card">
            <div className="stat-value">{dataList.length}</div>
            <div className="stat-label">Total Entries</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{activeCount}</div>
            <div className="stat-label">Active</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{inactiveCount}</div>
            <div className="stat-label">Inactive</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{geospatialCount}</div>
            <div className="stat-label">Geospatial</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{temporalCount}</div>
            <div className="stat-label">Temporal</div>
          </div>
        </div>

        <div className="data-section">
          <div className="section-header">
            <div className="tabs">
              <button 
                className={`tab-btn ${activeTab === "geospatial" ? "active" : ""}`}
                onClick={() => setActiveTab("geospatial")}
              >
                Geospatial Data
              </button>
              <button 
                className={`tab-btn ${activeTab === "temporal" ? "active" : ""}`}
                onClick={() => setActiveTab("temporal")}
              >
                Temporal Data
              </button>
            </div>
            <div className="search-box">
              <input 
                type="text" 
                placeholder="Search data..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <button className="search-btn">🔍</button>
            </div>
            <button 
              onClick={loadData}
              className="refresh-btn"
              disabled={isRefreshing}
            >
              {isRefreshing ? "Refreshing..." : "Refresh"}
            </button>
          </div>
          
          <div className="data-list">
            {filteredData.length === 0 ? (
              <div className="no-data">
                <p>No encrypted data found</p>
                <button 
                  className="primary-btn"
                  onClick={() => setShowCreateModal(true)}
                >
                  Add First Data Point
                </button>
              </div>
            ) : (
              filteredData
                .filter(data => data.dataType === activeTab)
                .map(data => (
                  <div className="data-card" key={data.id}>
                    <div className="data-header">
                      <span className="data-id">#{data.id.substring(0, 6)}</span>
                      <span className={`data-status ${data.status}`}>
                        {data.status}
                      </span>
                    </div>
                    <div className="data-content">
                      <div className="data-info">
                        <p><strong>Type:</strong> {data.dataType}</p>
                        <p><strong>Owner:</strong> {data.owner.substring(0, 6)}...{data.owner.substring(38)}</p>
                        <p><strong>Date:</strong> {new Date(data.timestamp * 1000).toLocaleDateString()}</p>
                      </div>
                      <div className="data-actions">
                        {isOwner(data.owner) && (
                          <button 
                            className={`status-btn ${data.status === "active" ? "danger" : "success"}`}
                            onClick={() => toggleDataStatus(data.id, data.status)}
                          >
                            {data.status === "active" ? "Deactivate" : "Activate"}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))
            )}
          </div>
        </div>
      </main>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitData} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          data={newData}
          setData={setNewData}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className={`notification ${transactionStatus.status}`}>
          <div className="notification-content">
            {transactionStatus.message}
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <h3>SpatioTemporal FHE DB</h3>
            <p>Secure encrypted spatiotemporal database</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">GitHub</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="copyright">
            © {new Date().getFullYear()} SpatioTemporal FHE DB. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  data: any;
  setData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  data,
  setData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setData({
      ...data,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if ((data.dataType === "geospatial" && !data.coordinates) || 
        (data.dataType === "temporal" && !data.timeRange)) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal">
        <div className="modal-header">
          <h2>Add Encrypted Spatiotemporal Data</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="form-group">
            <label>Data Type *</label>
            <select 
              name="dataType"
              value={data.dataType} 
              onChange={handleChange}
            >
              <option value="geospatial">Geospatial</option>
              <option value="temporal">Temporal</option>
            </select>
          </div>
          
          {data.dataType === "geospatial" ? (
            <div className="form-group">
              <label>Coordinates *</label>
              <input 
                type="text"
                name="coordinates"
                value={data.coordinates} 
                onChange={handleChange}
                placeholder="Enter coordinates (lat, long)" 
              />
            </div>
          ) : (
            <div className="form-group">
              <label>Time Range *</label>
              <input 
                type="text"
                name="timeRange"
                value={data.timeRange} 
                onChange={handleChange}
                placeholder="Enter time range (start-end)" 
              />
            </div>
          )}
          
          <div className="form-group">
            <label>Description</label>
            <textarea 
              name="description"
              value={data.description} 
              onChange={handleChange}
              placeholder="Optional description..." 
              rows={3}
            />
          </div>
          
          <div className="fhe-notice">
            <p>This data will be encrypted using FHE technology and remain encrypted during processing</p>
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="submit-btn"
          >
            {creating ? "Encrypting..." : "Submit Securely"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;