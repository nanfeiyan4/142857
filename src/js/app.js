import { ethers } from "./ethers.min.js";

// ========== Contract ABI (generated from Crowdfunding.sol) ==========
const CONTRACT_ABI = [
  // State-changing functions
  "function createProject(string memory _name, string memory _description, uint256 _targetAmount, uint256 _deadline) public",
  "function donate(uint256 _projectId) public payable",
  "function endProject(uint256 _projectId) public",
  "function withdrawFunds(uint256 _projectId) public",
  "function claimRefund(uint256 _projectId) public",
  // View functions
  "function projectCount() public view returns (uint256)",
  "function projects(uint256) public view returns (uint256 id, string memory name, string memory description, address creator, uint256 targetAmount, uint256 currentAmount, uint256 deadline, uint8 status)",
  "function getProject(uint256 _projectId) public view returns (uint256 id, string memory name, string memory description, address creator, uint256 targetAmount, uint256 currentAmount, uint256 deadline, uint8 status, uint256 donationCount)",
  "function getDonation(uint256 _projectId, uint256 _index) public view returns (address donor, uint256 amount, uint256 timestamp)",
  "function getDonorAmount(uint256 _projectId, address _donor) public view returns (uint256)",
  "function getDonationCount(uint256 _projectId) public view returns (uint256)",
  "function getAllProjectIds() public view returns (uint256[] memory)",
  // Events
  "event ProjectCreated(uint256 indexed id, string name, uint256 targetAmount, uint256 deadline, address indexed creator)",
  "event DonationReceived(uint256 indexed projectId, address indexed donor, uint256 amount, uint256 timestamp)",
  "event ProjectEnded(uint256 indexed projectId, uint8 status)",
  "event FundsWithdrawn(uint256 indexed projectId, address indexed creator, uint256 amount)",
  "event RefundClaimed(uint256 indexed projectId, address indexed donor, uint256 amount)"
];

// ========== CONFIGURATION ==========
// Update this address after deploying the contract
const CONTRACT_ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3";

// Hardhat TestNet configuration (Chain ID 31337 = 0x7A69)
const TESTNET_CONFIG = {
  chainId: "0x7A69",              // 31337 in hex
  chainIdDecimal: 31337,
  chainName: "Hardhat Local TestNet",
  rpcUrls: ["http://localhost:8545"],
  nativeCurrency: {
    name: "ETH",
    symbol: "ETH",
    decimals: 18,
  },
  blockExplorerUrls: null,
};

const DApp = {
  // MetaMask provider / signer (for reading data & wallet UI)
  provider: null,
  signer: null,
  contract: null,

  // Direct Hardhat-node provider / signer (for sending transactions — NO MetaMask popups)
  directProvider: null,
  directSigner: null,
  directContract: null,

  userAddress: null,
  currentDonateProjectId: null,
  correctChainId: TESTNET_CONFIG.chainIdDecimal,
  currentChainId: null,

  // ========== Initialization ==========

  init: async function () {
    console.log("Initializing Crowdfunding DApp...");
    DApp.bindEvents();
    await DApp.initWeb3();
  },

  initWeb3: async function () {
    try {
      // Check if MetaMask is installed
      if (typeof window.ethereum === "undefined") {
        DApp.showToast("请安装 MetaMask 浏览器插件！", "warning");
        document.getElementById("walletStatus").textContent = "未检测到钱包";
        document.getElementById("walletStatus").className = "badge bg-danger";
        return;
      }

      DApp.provider = new ethers.BrowserProvider(window.ethereum);

      // Check and switch to the correct network before initializing
      const networkOk = await DApp.ensureCorrectNetwork();
      if (!networkOk) return;

      await DApp.initContract();

      // Listen for account changes
      window.ethereum.on("accountsChanged", async (accounts) => {
        if (accounts.length > 0) {
          DApp.userAddress = accounts[0];
          DApp.updateWalletUI();
          // Re-init direct signer for the new account
          await DApp.initDirectSigner();
          await DApp.loadProjects();
        } else {
          DApp.userAddress = null;
          DApp.updateWalletUI();
        }
      });

      // Listen for chain changes
      window.ethereum.on("chainChanged", async (chainIdHex) => {
        const newChainId = parseInt(chainIdHex, 16);
        if (newChainId !== DApp.correctChainId) {
          DApp.showToast("检测到网络切换，请连接 Hardhat Local TestNet (Chain ID: 31337)", "warning");
          document.getElementById("walletStatus").textContent = "错误网络";
          document.getElementById("walletStatus").className = "badge bg-danger";
        } else {
          window.location.reload();
        }
      });

    } catch (error) {
      console.error("Web3 init error:", error);
      DApp.showToast("初始化 Web3 失败: " + error.message, "danger");
    }
  },

  /**
   * Create a direct JSON-RPC provider to the Hardhat node and impersonate
   * the user's MetaMask address so transactions skip MetaMask entirely.
   */
  initDirectSigner: async function () {
    if (!DApp.userAddress) return;

    try {
      console.log("Setting up direct Hardhat signer for:", DApp.userAddress);

      // Direct provider to Hardhat node (bypasses MetaMask)
      DApp.directProvider = new ethers.JsonRpcProvider("http://localhost:8545");

      // Tell Hardhat to impersonate the user's MetaMask address.
      // This allows sending transactions from that address without a signature.
      await DApp.directProvider.send("hardhat_impersonateAccount", [DApp.userAddress]);

      // Get a signer for the impersonated account
      DApp.directSigner = await DApp.directProvider.getSigner(DApp.userAddress);

      // Fund the impersonated account if balance is low (Hardhat pre-funded accounts
      // have 10000 ETH, but MetaMask-imported addresses start with 0)
      const balance = await DApp.directProvider.getBalance(DApp.userAddress);
      if (balance < ethers.parseEther("100")) {
        // Steal some ETH from a Hardhat pre-funded account
        const richAccounts = await DApp.directProvider.listAccounts();
        if (richAccounts.length > 0 && richAccounts[0].address !== DApp.userAddress) {
          const richSigner = await DApp.directProvider.getSigner(richAccounts[0].address);
          await richSigner.sendTransaction({
            to: DApp.userAddress,
            value: ethers.parseEther("1000"),
          });
          console.log("Funded", DApp.userAddress, "with 1000 ETH from Hardhat account");
        }
      }

      // Create contract instance backed by the direct signer
      DApp.directContract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, DApp.directSigner);

      console.log("Direct Hardhat signer ready — transactions will auto-confirm without MetaMask popups");
    } catch (error) {
      console.error("Failed to setup direct signer:", error);
      DApp.showToast("直连 Hardhat 节点失败，请确保 hardhat node 正在运行", "danger");
    }
  },

  initContract: async function () {
    try {
      DApp.signer = await DApp.provider.getSigner();
      DApp.userAddress = await DApp.signer.getAddress();

      // MetaMask-backed contract (for reading data)
      DApp.contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, DApp.signer);

      // Direct Hardhat-backed contract (for sending transactions — no popups)
      await DApp.initDirectSigner();

      DApp.updateWalletUI();
      await DApp.loadProjects();
      console.log("Contract initialized successfully on TestNet (Chain ID: 31337)");
    } catch (error) {
      console.error("Contract init error:", error);
      DApp.showToast("合约初始化失败，请检查合约地址和网络", "danger");
    }
  },

  bindEvents: function () {
    // Connect wallet button
    document.getElementById("btnConnect").addEventListener("click", () => DApp.connectWallet());

    // Refresh button
    document.getElementById("btnRefresh").addEventListener("click", () => DApp.loadProjects());

    // Create project form
    document.getElementById("createProjectForm").addEventListener("submit", (e) => {
      e.preventDefault();
      DApp.handleCreateProject();
    });

    // Donate confirm button
    document.getElementById("btnDonateConfirm").addEventListener("click", () => DApp.handleDonate());

    // Tab change — reload data
    document.getElementById("myinfo-tab").addEventListener("shown.bs.tab", () => DApp.loadMyInfo());
  },

  // ========== Network Management ==========

  /**
   * Ensure MetaMask is connected to Hardhat TestNet (Chain ID 31337).
   */
  ensureCorrectNetwork: async function () {
    try {
      const chainIdHex = await window.ethereum.request({ method: "eth_chainId" });
      DApp.currentChainId = parseInt(chainIdHex, 16);
      console.log("Current chain ID:", DApp.currentChainId, "(target:", DApp.correctChainId, ")");

      if (DApp.currentChainId === DApp.correctChainId) {
        return true;
      }

      try {
        console.log("Switching to Hardhat TestNet...");
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: TESTNET_CONFIG.chainId }],
        });
        DApp.currentChainId = DApp.correctChainId;
        DApp.showToast("已切换到 Hardhat Local TestNet (Chain ID: 31337)", "success");
        return true;
      } catch (switchError) {
        if (switchError.code === 4902) {
          try {
            await window.ethereum.request({
              method: "wallet_addEthereumChain",
              params: [TESTNET_CONFIG],
            });
            DApp.currentChainId = DApp.correctChainId;
            DApp.showToast("已添加并切换到 Hardhat Local TestNet", "success");
            return true;
          } catch (addError) {
            console.error("Failed to add network:", addError);
            DApp.showToast(
              "请在 MetaMask 中手动添加网络：\n" +
              "RPC: http://localhost:8545\nChain ID: 31337\nSymbol: ETH",
              "danger"
            );
            return false;
          }
        }
        console.error("Failed to switch network:", switchError);
        DApp.showToast(
          "请手动切换到 Hardhat Local TestNet\n(Chain ID: 31337, RPC: localhost:8545)",
          "warning"
        );
        return false;
      }
    } catch (error) {
      console.error("Network check error:", error);
      return true;
    }
  },

  // ========== Wallet Connection ==========

  connectWallet: async function () {
    try {
      if (typeof window.ethereum === "undefined") {
        DApp.showToast("请安装 MetaMask!", "warning");
        return;
      }

      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      DApp.userAddress = accounts[0];

      const networkOk = await DApp.ensureCorrectNetwork();
      if (!networkOk) {
        DApp.updateWalletUI();
        DApp.showToast("请切换到 Hardhat Local TestNet 后再操作", "warning");
        return;
      }

      DApp.signer = await DApp.provider.getSigner();
      DApp.contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, DApp.signer);

      // Setup direct Hardhat signer for auto-confirmed transactions
      await DApp.initDirectSigner();

      DApp.updateWalletUI();
      await DApp.loadProjects();
      DApp.showToast("钱包连接成功！(TestNet — 交易将自动确认)", "success");
    } catch (error) {
      console.error("Connect wallet error:", error);
      DApp.showToast("连接钱包失败: " + DApp.parseError(error), "danger");
    }
  },

  updateWalletUI: function () {
    const statusEl = document.getElementById("walletStatus");
    const addressEl = document.getElementById("walletAddress");
    const btnConnect = document.getElementById("btnConnect");

    if (DApp.userAddress) {
      const onCorrectNet = DApp.currentChainId === DApp.correctChainId;
      if (onCorrectNet) {
        statusEl.textContent = DApp.directSigner ? "TestNet ✓ (自动)" : "TestNet ✓";
        statusEl.className = "badge bg-success";
      } else {
        statusEl.textContent = "错误网络 ⚠";
        statusEl.className = "badge bg-danger";
      }
      const shortAddr = DApp.userAddress.slice(0, 6) + "..." + DApp.userAddress.slice(-4);
      addressEl.textContent = shortAddr + " | Chain: " + (DApp.currentChainId || "?");
      btnConnect.textContent = "切换钱包";
    } else {
      statusEl.textContent = "未连接钱包";
      statusEl.className = "badge bg-warning text-dark";
      addressEl.textContent = "";
      btnConnect.textContent = "连接钱包";
    }
  },

  // ========== Direct Transaction Sender (bypasses MetaMask entirely) ==========

  /**
   * Send a state-changing transaction directly to the Hardhat node.
   * Uses the impersonated signer — NO MetaMask confirmation popup.
   */
  sendDirect: async function (method, args, overrides = {}) {
    if (!DApp.directContract) {
      throw new Error("Direct contract not initialized. Is Hardhat node running?");
    }

    // Build the transaction
    const txData = await method.populateTransaction(...args, overrides);
    txData.gasLimit = 5000000n;

    // Send via the direct (impersonated) signer — auto-confirmed
    const tx = await DApp.directSigner.sendTransaction(txData);
    return tx;
  },

  // ========== Load Projects ==========

  loadProjects: async function () {
    // Prefer MetaMask contract; fall back to directContract
    const readContract = DApp.contract || DApp.directContract;
    if (!readContract) return;

    try {
      const container = document.getElementById("projectsContainer");
      const noProjects = document.getElementById("noProjects");
      const countEl = document.getElementById("projectCount");

      if (!container) {
        console.warn("loadProjects: projectsContainer not found in DOM");
        return;
      }

      container.innerHTML = "";

      const projectIds = await readContract.getAllProjectIds();
      if (countEl) countEl.textContent = projectIds.length;

      if (projectIds.length === 0) {
        if (noProjects) noProjects.classList.remove("d-none");
        return;
      }
      if (noProjects) noProjects.classList.add("d-none");

      const projectPromises = [];
      for (const id of projectIds) {
        projectPromises.push(DApp.fetchProjectDetail(Number(id)));
      }
      const projects = await Promise.all(projectPromises);

      projects.forEach((project) => {
        if (project) {
          container.appendChild(DApp.createProjectCard(project));
        }
      });

    } catch (error) {
      console.error("Load projects error:", error);
      DApp.showToast("加载项目失败: " + (error.message || error), "danger");
    }
  },

  fetchProjectDetail: async function (projectId) {
    const readContract = DApp.contract || DApp.directContract;
    try {
      const project = await readContract.getProject(projectId);
      const donationCount = Number(project.donationCount);
      const donations = [];
      for (let i = 0; i < Math.min(donationCount, 50); i++) {
        const d = await readContract.getDonation(projectId, i);
        donations.push({
          donor: d.donor,
          amount: ethers.formatEther(d.amount),
          timestamp: Number(d.timestamp),
        });
      }

      let userDonated = "0";
      if (DApp.userAddress) {
        const raw = await readContract.getDonorAmount(projectId, DApp.userAddress);
        userDonated = ethers.formatEther(raw);
      }

      return {
        id: Number(project.id),
        name: project.name,
        description: project.description,
        creator: project.creator,
        targetAmount: ethers.formatEther(project.targetAmount),
        currentAmount: ethers.formatEther(project.currentAmount),
        deadline: Number(project.deadline),
        status: Number(project.status),
        donationCount: donationCount,
        donations: donations,
        userDonated: userDonated,
      };
    } catch (error) {
      console.error(`Fetch project ${projectId} error:`, error);
      return null;
    }
  },

  createProjectCard: function (project) {
    const col = document.createElement("div");
    col.className = "col-12 col-md-6 col-lg-4";

    const now = Math.floor(Date.now() / 1000);
    const isOngoing = project.status === 0;
    const isSuccessful = project.status === 1;
    const isFailed = project.status === 2;
    const deadlinePassed = now >= project.deadline;
    const canEnd = isOngoing && deadlinePassed;
    const isCreator = DApp.userAddress && DApp.userAddress.toLowerCase() === project.creator.toLowerCase();
    const hasDonated = parseFloat(project.userDonated) > 0;
    const progressPct = parseFloat(project.targetAmount) > 0
      ? Math.min(100, (parseFloat(project.currentAmount) / parseFloat(project.targetAmount)) * 100)
      : 0;

    let statusBadge = "";
    if (isOngoing && !deadlinePassed) {
      statusBadge = '<span class="badge bg-primary">进行中</span>';
    } else if (isOngoing && deadlinePassed) {
      statusBadge = '<span class="badge bg-warning text-dark">待结束</span>';
    } else if (isSuccessful) {
      statusBadge = '<span class="badge bg-success">已成功</span>';
    } else if (isFailed) {
      statusBadge = '<span class="badge bg-danger">已失败</span>';
    }

    let timeDisplay = "";
    if (isOngoing && !deadlinePassed) {
      const remaining = project.deadline - now;
      const days = Math.floor(remaining / 86400);
      const hours = Math.floor((remaining % 86400) / 3600);
      const mins = Math.floor((remaining % 3600) / 60);
      timeDisplay = `<span class="text-muted">剩余: ${days}天 ${hours}时 ${mins}分</span>`;
    } else if (deadlinePassed && isOngoing) {
      timeDisplay = '<span class="text-danger">已截止</span>';
    } else {
      timeDisplay = '<span class="text-muted">已结束</span>';
    }

    const deadlineDate = new Date(project.deadline * 1000).toLocaleString("zh-CN");

    let actionButtons = "";

    if (isOngoing && !deadlinePassed) {
      actionButtons += `
        <button class="btn btn-success btn-sm me-1 btn-donate" data-id="${project.id}">
          <i class="bi bi-cash-coin"></i> 捐赠
        </button>`;
    }

    if (canEnd) {
      actionButtons += `
        <button class="btn btn-warning btn-sm me-1 btn-end" data-id="${project.id}">
          <i class="bi bi-stop-circle"></i> 结束项目
        </button>`;
    }

    if (isSuccessful && isCreator && parseFloat(project.currentAmount) > 0) {
      actionButtons += `
        <button class="btn btn-primary btn-sm me-1 btn-withdraw" data-id="${project.id}">
          <i class="bi bi-wallet2"></i> 提取资金
        </button>`;
    }

    if (isFailed && hasDonated) {
      actionButtons += `
        <button class="btn btn-danger btn-sm me-1 btn-refund" data-id="${project.id}">
          <i class="bi bi-arrow-return-left"></i> 退款
        </button>`;
    }

    if (project.donationCount > 0) {
      actionButtons += `
        <button class="btn btn-outline-info btn-sm btn-donors" data-id="${project.id}">
          <i class="bi bi-people"></i> 捐赠者 (${project.donationCount})
        </button>`;
    }

    col.innerHTML = `
      <div class="card h-100 shadow-sm project-card" data-status="${project.status}">
        <div class="card-header d-flex justify-content-between align-items-center">
          <h5 class="card-title mb-0 text-truncate" title="${DApp.escapeHtml(project.name)}">
            ${DApp.escapeHtml(project.name)}
          </h5>
          ${statusBadge}
        </div>
        <div class="card-body">
          <p class="card-text text-muted small project-desc">
            ${DApp.escapeHtml(project.description)}
          </p>

          <div class="mb-3">
            <div class="d-flex justify-content-between small mb-1">
              <span>已筹: ${parseFloat(project.currentAmount).toFixed(4)} ETH</span>
              <span>目标: ${parseFloat(project.targetAmount).toFixed(4)} ETH</span>
            </div>
            <div class="progress" style="height: 20px;">
              <div class="progress-bar ${progressPct >= 100 ? 'bg-success' : 'bg-primary'} progress-bar-striped"
                role="progressbar" style="width: ${progressPct}%;">
                ${progressPct.toFixed(1)}%
              </div>
            </div>
          </div>

          <div class="small">
            <p class="mb-1"><strong>发起人：</strong>
              <span class="text-muted">${DApp.shortenAddress(project.creator)}</span>
            </p>
            <p class="mb-1"><strong>截止日期：</strong>${deadlineDate}</p>
            <p class="mb-1">${timeDisplay}</p>
            ${hasDonated ? `<p class="mb-1"><strong>我的捐赠：</strong>${parseFloat(project.userDonated).toFixed(4)} ETH</p>` : ""}
          </div>
        </div>
        <div class="card-footer">
          <div class="d-flex flex-wrap">
            ${actionButtons}
          </div>
        </div>
      </div>
    `;

    DApp.bindCardEvents(col, project);
    return col;
  },

  bindCardEvents: function (cardElement, project) {
    cardElement.querySelector(".btn-donate")?.addEventListener("click", () => {
      DApp.currentDonateProjectId = project.id;
      document.getElementById("donateProjectName").textContent = `项目: ${project.name}`;
      document.getElementById("donateAmount").value = "";
      const modal = new bootstrap.Modal(document.getElementById("donateModal"));
      modal.show();
    });

    cardElement.querySelector(".btn-end")?.addEventListener("click", () => {
      if (confirm(`确定要结束项目 "${project.name}" 吗？`)) {
        DApp.handleEndProject(project.id);
      }
    });

    cardElement.querySelector(".btn-withdraw")?.addEventListener("click", () => {
      if (confirm(`确定要提取项目 "${project.name}" 的 ${project.currentAmount} ETH 吗？`)) {
        DApp.handleWithdrawFunds(project.id);
      }
    });

    cardElement.querySelector(".btn-refund")?.addEventListener("click", () => {
      if (confirm(`确定要退回你在项目 "${project.name}" 中的 ${project.userDonated} ETH 吗？`)) {
        DApp.handleClaimRefund(project.id);
      }
    });

    cardElement.querySelector(".btn-donors")?.addEventListener("click", () => {
      DApp.showDonorList(project);
    });
  },

  // ========== Project Actions (all use direct Hardhat signer — NO MetaMask popups) ==========

  handleCreateProject: async function () {
    if (!DApp.directContract) {
      DApp.showToast("请先连接钱包并确保 Hardhat 节点正在运行！", "warning");
      return;
    }

    const name = document.getElementById("projectName").value.trim();
    const description = document.getElementById("projectDesc").value.trim();
    const targetAmountEth = document.getElementById("targetAmount").value;
    const deadlineStr = document.getElementById("deadline").value;

    if (!name || !description || !targetAmountEth || !deadlineStr) {
      DApp.showToast("请填写所有必填字段", "warning");
      return;
    }

    try {
      const targetAmountWei = ethers.parseEther(targetAmountEth);
      const deadlineTimestamp = Math.floor(new Date(deadlineStr).getTime() / 1000);

      if (deadlineTimestamp <= Math.floor(Date.now() / 1000)) {
        DApp.showToast("截止日期必须在未来！", "warning");
        return;
      }

      DApp.showLoading(true);
      console.log("Creating project directly via Hardhat node (no MetaMask popup)...");

      const tx = await DApp.sendDirect(
        DApp.directContract.createProject,
        [name, description, targetAmountWei, deadlineTimestamp]
      );
      DApp.showToast("交易已发送，等待确认...", "info");
      await tx.wait();

      DApp.showToast(`项目 "${name}" 创建成功！`, "success");
      document.getElementById("createProjectForm").reset();

      const projectsTab = new bootstrap.Tab(document.getElementById("projects-tab"));
      projectsTab.show();
      await DApp.loadProjects();

    } catch (error) {
      console.error("Create project error:", error);
      DApp.showToast("创建项目失败: " + DApp.parseError(error), "danger");
    } finally {
      DApp.showLoading(false);
    }
  },

  handleDonate: async function () {
    if (!DApp.directContract || !DApp.currentDonateProjectId) return;

    const amountEth = document.getElementById("donateAmount").value;
    if (!amountEth || parseFloat(amountEth) <= 0) {
      DApp.showToast("请输入有效的捐赠金额", "warning");
      return;
    }

    try {
      const amountWei = ethers.parseEther(amountEth);

      DApp.showLoading(true);
      console.log("Donating directly via Hardhat node (no MetaMask popup)...");

      const tx = await DApp.sendDirect(
        DApp.directContract.donate,
        [DApp.currentDonateProjectId],
        { value: amountWei }
      );
      DApp.showToast("交易已发送，等待确认...", "info");
      await tx.wait();

      DApp.showToast(`成功捐赠 ${amountEth} ETH！`, "success");

      bootstrap.Modal.getInstance(document.getElementById("donateModal")).hide();
      DApp.currentDonateProjectId = null;

      await DApp.loadProjects();

    } catch (error) {
      console.error("Donate error:", error);
      DApp.showToast("捐赠失败: " + DApp.parseError(error), "danger");
    } finally {
      DApp.showLoading(false);
    }
  },

  handleEndProject: async function (projectId) {
    if (!DApp.directContract) return;
    try {
      DApp.showLoading(true);
      const tx = await DApp.sendDirect(
        DApp.directContract.endProject,
        [projectId]
      );
      DApp.showToast("交易已发送，等待确认...", "info");
      await tx.wait();

      DApp.showToast("项目已结束！", "success");
      await DApp.loadProjects();
    } catch (error) {
      console.error("End project error:", error);
      DApp.showToast("结束项目失败: " + DApp.parseError(error), "danger");
    } finally {
      DApp.showLoading(false);
    }
  },

  handleWithdrawFunds: async function (projectId) {
    if (!DApp.directContract) return;
    try {
      DApp.showLoading(true);
      const tx = await DApp.sendDirect(
        DApp.directContract.withdrawFunds,
        [projectId]
      );
      DApp.showToast("交易已发送，等待确认...", "info");
      await tx.wait();

      DApp.showToast("资金提取成功！", "success");
      await DApp.loadProjects();
    } catch (error) {
      console.error("Withdraw error:", error);
      DApp.showToast("提取资金失败: " + DApp.parseError(error), "danger");
    } finally {
      DApp.showLoading(false);
    }
  },

  handleClaimRefund: async function (projectId) {
    if (!DApp.directContract) return;
    try {
      DApp.showLoading(true);
      const tx = await DApp.sendDirect(
        DApp.directContract.claimRefund,
        [projectId]
      );
      DApp.showToast("交易已发送，等待确认...", "info");
      await tx.wait();

      DApp.showToast("退款成功！", "success");
      await DApp.loadProjects();
    } catch (error) {
      console.error("Refund error:", error);
      DApp.showToast("退款失败: " + DApp.parseError(error), "danger");
    } finally {
      DApp.showLoading(false);
    }
  },

  // ========== My Info ==========

  loadMyInfo: async function () {
    const readContract = DApp.contract || DApp.directContract;
    if (!readContract || !DApp.userAddress) {
      document.getElementById("myAddress").textContent = "请先连接钱包";
      return;
    }

    document.getElementById("myAddress").textContent = DApp.userAddress;
    try {
      const provider = DApp.directProvider || DApp.provider;
      const balance = await provider.getBalance(DApp.userAddress);
      document.getElementById("myBalance").textContent = parseFloat(ethers.formatEther(balance)).toFixed(4);
    } catch (e) {
      document.getElementById("myBalance").textContent = "--";
    }

    try {
      const projectIds = await readContract.getAllProjectIds();
      const projects = [];
      for (const id of projectIds) {
        const p = await DApp.fetchProjectDetail(Number(id));
        if (p) projects.push(p);
      }

      const myCreated = projects.filter(
        (p) => p.creator.toLowerCase() === DApp.userAddress.toLowerCase()
      );
      const myProjectsDiv = document.getElementById("myProjects");
      if (myCreated.length === 0) {
        myProjectsDiv.innerHTML = '<p class="text-muted">暂无创建的项目</p>';
      } else {
        myProjectsDiv.innerHTML = myCreated
          .map((p) => {
            const statusText = ["进行中", "已成功", "已失败"][p.status];
            return `
            <div class="d-flex justify-content-between align-items-center border-bottom py-2">
              <div>
                <strong>${DApp.escapeHtml(p.name)}</strong>
                <span class="badge ms-2 ${p.status === 1 ? 'bg-success' : p.status === 2 ? 'bg-danger' : 'bg-primary'}">${statusText}</span>
              </div>
              <span class="text-muted">${p.currentAmount} / ${p.targetAmount} ETH</span>
            </div>`;
          })
          .join("");
      }

      const myDonations = [];
      projects.forEach((p) => {
        p.donations.forEach((d) => {
          if (d.donor.toLowerCase() === DApp.userAddress.toLowerCase()) {
            myDonations.push({ projectName: p.name, projectId: p.id, ...d });
          }
        });
      });
      const myDonationsDiv = document.getElementById("myDonations");
      if (myDonations.length === 0) {
        myDonationsDiv.innerHTML = '<p class="text-muted">暂无捐赠记录</p>';
      } else {
        myDonationsDiv.innerHTML = myDonations
          .map(
            (d) => `
            <div class="d-flex justify-content-between align-items-center border-bottom py-2">
              <div>
                <strong>${DApp.escapeHtml(d.projectName)}</strong>
                <span class="text-muted ms-2">${new Date(d.timestamp * 1000).toLocaleString("zh-CN")}</span>
              </div>
              <span class="text-success">${parseFloat(d.amount).toFixed(4)} ETH</span>
            </div>`
          )
          .join("");
      }
    } catch (error) {
      console.error("Load my info error:", error);
    }
  },

  // ========== Donor List Modal ==========

  showDonorList: function (project) {
    const tbody = document.getElementById("donorListBody");
    if (project.donations.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">暂无捐赠记录</td></tr>';
    } else {
      tbody.innerHTML = project.donations
        .map(
          (d, i) => `
        <tr>
          <td>${i + 1}</td>
          <td><span class="text-monospace">${DApp.shortenAddress(d.donor)}</span></td>
          <td>${parseFloat(d.amount).toFixed(4)} ETH</td>
          <td>${new Date(d.timestamp * 1000).toLocaleString("zh-CN")}</td>
        </tr>`
        )
        .join("");
    }

    const modal = new bootstrap.Modal(document.getElementById("donorListModal"));
    modal.show();
  },

  // ========== Utility Functions ==========

  shortenAddress: function (address) {
    if (!address) return "--";
    return address.slice(0, 6) + "..." + address.slice(-4);
  },

  escapeHtml: function (str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  },

  parseError: function (error) {
    if (error.reason) return error.reason;
    if (error.data?.message) return error.data.message;
    if (error.message) {
      const match = error.message.match(/reverted with reason string '(.*?)'/);
      if (match) return match[1];
      if (error.message.includes("user rejected")) return "用户取消了交易";
      if (error.message.includes("signal is aborted") || error.message.includes("aborted without reason")) {
        return "MetaMask 交易被中止。请尝试：\n1. 在 MetaMask 设置中重置账户\n2. 确保 Hardhat 节点正在运行\n3. 刷新页面后重试";
      }
      if (error.message.includes("-32603") || error.message.includes("Internal JSON-RPC error")) {
        return "MetaMask 内部错误。请尝试重置 MetaMask 账户（设置 → 高级 → 重置账户），然后刷新页面";
      }
      return error.message.substring(0, 200);
    }
    return "未知错误";
  },

  showToast: function (message, type = "info") {
    const container = document.getElementById("toastContainer");
    const toastId = "toast-" + Date.now();

    const bgClass = {
      success: "bg-success text-white",
      danger: "bg-danger text-white",
      warning: "bg-warning text-dark",
      info: "bg-info text-white",
    }[type] || "bg-info text-white";

    const iconMap = {
      success: "bi-check-circle-fill",
      danger: "bi-exclamation-triangle-fill",
      warning: "bi-exclamation-circle-fill",
      info: "bi-info-circle-fill",
    };

    const toastHtml = `
      <div id="${toastId}" class="toast ${bgClass}" role="alert" data-bs-delay="5000">
        <div class="toast-body d-flex align-items-center">
          <i class="bi ${iconMap[type]} me-2"></i>
          <span>${message}</span>
          <button type="button" class="btn-close btn-close-white ms-auto" data-bs-dismiss="toast"></button>
        </div>
      </div>
    `;

    container.insertAdjacentHTML("beforeend", toastHtml);
    const toastEl = document.getElementById(toastId);
    const toast = new bootstrap.Toast(toastEl);
    toast.show();

    toastEl.addEventListener("hidden.bs.toast", () => toastEl.remove());
  },

  showLoading: function (show) {
    const overlay = document.getElementById("loadingOverlay");
    if (!overlay) return;
    if (show) {
      overlay.classList.remove("d-none");
      overlay.classList.add("d-flex", "justify-content-center", "align-items-center",
        "position-fixed", "top-0", "start-0", "w-100", "h-100",
        "bg-dark", "bg-opacity-25");
      overlay.style.zIndex = "9999";
    } else {
      overlay.classList.add("d-none");
      overlay.classList.remove("d-flex", "justify-content-center", "align-items-center",
        "position-fixed", "top-0", "start-0", "w-100", "h-100",
        "bg-dark", "bg-opacity-25");
    }
  },
};

export { DApp };
