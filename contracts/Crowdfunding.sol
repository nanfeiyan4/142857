// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title Crowdfunding
 * @dev A blockchain-based crowdfunding system
 */
contract Crowdfunding {
    // ============ Enums ============

    enum ProjectStatus {
        Ongoing,    // 0 - Project is still accepting donations
        Successful, // 1 - Project reached its target and funds were withdrawn
        Failed      // 2 - Project did not reach its target
    }

    // ============ Structs ============

    struct Donation {
        address donor;
        uint256 amount;
        uint256 timestamp;
    }

    struct Project {
        uint256 id;
        string name;
        string description;
        address payable creator;
        uint256 targetAmount;
        uint256 currentAmount;
        uint256 deadline;
        ProjectStatus status;
    }

    // ============ State Variables ============

    uint256 public projectCount;
    mapping(uint256 => Project) public projects;
    mapping(uint256 => Donation[]) private _projectDonations;
    mapping(uint256 => mapping(address => uint256)) private _donorAmounts;

    // ============ Events ============

    event ProjectCreated(
        uint256 indexed id,
        string name,
        uint256 targetAmount,
        uint256 deadline,
        address indexed creator
    );

    event DonationReceived(
        uint256 indexed projectId,
        address indexed donor,
        uint256 amount,
        uint256 timestamp
    );

    event ProjectEnded(
        uint256 indexed projectId,
        ProjectStatus status
    );

    event FundsWithdrawn(
        uint256 indexed projectId,
        address indexed creator,
        uint256 amount
    );

    event RefundClaimed(
        uint256 indexed projectId,
        address indexed donor,
        uint256 amount
    );

    // ============ Modifiers ============

    modifier projectExists(uint256 _projectId) {
        require(_projectId > 0 && _projectId <= projectCount, "Project does not exist");
        _;
    }

    // ============ Core Functions ============

    /**
     * @dev Create a new crowdfunding project
     * @param _name Project name
     * @param _description Project description
     * @param _targetAmount Funding target in wei
     * @param _deadline Unix timestamp of the project deadline
     */
    function createProject(
        string memory _name,
        string memory _description,
        uint256 _targetAmount,
        uint256 _deadline
    ) public {
        require(bytes(_name).length > 0, "Project name cannot be empty");
        require(_targetAmount > 0, "Target amount must be greater than 0");
        require(_deadline > block.timestamp, "Deadline must be in the future");

        projectCount++;

        Project storage p = projects[projectCount];
        p.id = projectCount;
        p.name = _name;
        p.description = _description;
        p.creator = payable(msg.sender);
        p.targetAmount = _targetAmount;
        p.currentAmount = 0;
        p.deadline = _deadline;
        p.status = ProjectStatus.Ongoing;

        emit ProjectCreated(projectCount, _name, _targetAmount, _deadline, msg.sender);
    }

    /**
     * @dev Donate ETH to a project
     * @param _projectId The ID of the project to donate to
     */
    function donate(uint256 _projectId)
        public
        payable
        projectExists(_projectId)
    {
        Project storage p = projects[_projectId];
        require(p.status == ProjectStatus.Ongoing, "Project is not accepting donations");
        require(block.timestamp < p.deadline, "Project deadline has passed");
        require(msg.value > 0, "Donation amount must be greater than 0");

        // Record the donation
        _projectDonations[_projectId].push(Donation({
            donor: msg.sender,
            amount: msg.value,
            timestamp: block.timestamp
        }));

        _donorAmounts[_projectId][msg.sender] += msg.value;
        p.currentAmount += msg.value;

        emit DonationReceived(_projectId, msg.sender, msg.value, block.timestamp);
    }

    /**
     * @dev End a project after its deadline. Anyone can call this.
     *      If target is met → Successful; otherwise → Failed.
     * @param _projectId The ID of the project to end
     */
    function endProject(uint256 _projectId)
        public
        projectExists(_projectId)
    {
        Project storage p = projects[_projectId];
        require(p.status == ProjectStatus.Ongoing, "Project is not ongoing");
        require(block.timestamp >= p.deadline, "Deadline has not passed yet");

        if (p.currentAmount >= p.targetAmount) {
            p.status = ProjectStatus.Successful;
        } else {
            p.status = ProjectStatus.Failed;
        }

        emit ProjectEnded(_projectId, p.status);
    }

    /**
     * @dev Creator withdraws all donated funds after project succeeds.
     *      Uses checks-effects-interactions to prevent re-entrancy.
     * @param _projectId The ID of the project
     */
    function withdrawFunds(uint256 _projectId)
        public
        projectExists(_projectId)
    {
        Project storage p = projects[_projectId];
        require(p.status == ProjectStatus.Successful, "Project is not successful");
        require(msg.sender == p.creator, "Only the creator can withdraw funds");
        require(p.currentAmount > 0, "No funds to withdraw");

        uint256 amount = p.currentAmount;
        // Effects before interaction (re-entrancy protection)
        p.currentAmount = 0;

        // Interaction
        (bool success, ) = p.creator.call{value: amount}("");
        require(success, "Transfer to creator failed");

        emit FundsWithdrawn(_projectId, msg.sender, amount);
    }

    /**
     * @dev Donor claims refund after project fails.
     *      Uses checks-effects-interactions to prevent re-entrancy.
     * @param _projectId The ID of the project
     */
    function claimRefund(uint256 _projectId)
        public
        projectExists(_projectId)
    {
        Project storage p = projects[_projectId];
        require(p.status == ProjectStatus.Failed, "Project is not failed");

        uint256 donatedAmount = _donorAmounts[_projectId][msg.sender];
        require(donatedAmount > 0, "No donation to refund");

        // Effects before interaction (re-entrancy protection)
        _donorAmounts[_projectId][msg.sender] = 0;

        // Interaction
        (bool success, ) = payable(msg.sender).call{value: donatedAmount}("");
        require(success, "Refund transfer failed");

        emit RefundClaimed(_projectId, msg.sender, donatedAmount);
    }

    // ============ View / Query Functions ============

    /**
     * @dev Get full project details
     */
    function getProject(uint256 _projectId)
        public
        view
        projectExists(_projectId)
        returns (
            uint256 id,
            string memory name,
            string memory description,
            address creator,
            uint256 targetAmount,
            uint256 currentAmount,
            uint256 deadline,
            ProjectStatus status,
            uint256 donationCount
        )
    {
        Project storage p = projects[_projectId];
        return (
            p.id,
            p.name,
            p.description,
            p.creator,
            p.targetAmount,
            p.currentAmount,
            p.deadline,
            p.status,
            _projectDonations[_projectId].length
        );
    }

    /**
     * @dev Get a single donation record by project and index
     */
    function getDonation(uint256 _projectId, uint256 _index)
        public
        view
        projectExists(_projectId)
        returns (
            address donor,
            uint256 amount,
            uint256 timestamp
        )
    {
        require(_index < _projectDonations[_projectId].length, "Index out of bounds");
        Donation storage d = _projectDonations[_projectId][_index];
        return (d.donor, d.amount, d.timestamp);
    }

    /**
     * @dev Get the total amount donated by an address to a project
     */
    function getDonorAmount(uint256 _projectId, address _donor)
        public
        view
        returns (uint256)
    {
        return _donorAmounts[_projectId][_donor];
    }

    /**
     * @dev Get donation count for a project
     */
    function getDonationCount(uint256 _projectId)
        public
        view
        projectExists(_projectId)
        returns (uint256)
    {
        return _projectDonations[_projectId].length;
    }

    /**
     * @dev Get all project IDs
     */
    function getAllProjectIds()
        public
        view
        returns (uint256[] memory)
    {
        uint256[] memory ids = new uint256[](projectCount);
        for (uint256 i = 0; i < projectCount; i++) {
            ids[i] = i + 1;
        }
        return ids;
    }
}
