// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract SpatioTemporalDB is SepoliaConfig {
    struct EncryptedPoint {
        uint256 id;
        euint32 encryptedLat;       // Encrypted latitude
        euint32 encryptedLon;      // Encrypted longitude
        euint32 encryptedTimestamp; // Encrypted timestamp
        uint256 submissionTime;
    }
    
    struct QueryResult {
        uint256[] pointIds;         // IDs of matching points
        euint32[] distances;        // Encrypted distances to query point
        bool isComplete;
    }
    
    struct DecryptedResult {
        uint256[] pointIds;
        uint32[] distances;
        bool isRevealed;
    }
    
    // Contract state
    uint256 public pointCount;
    mapping(uint256 => EncryptedPoint) public encryptedPoints;
    mapping(bytes32 => QueryResult) public queryResults;
    mapping(bytes32 => DecryptedResult) public decryptedResults;
    
    // Spatial index (simplified)
    mapping(uint32 => uint256[]) private gridIndex;
    
    // Decryption requests tracking
    mapping(uint256 => bytes32) private requestToQueryHash;
    
    // Events
    event PointSubmitted(uint256 indexed id, uint256 timestamp);
    event QueryExecuted(bytes32 indexed queryHash);
    event ResultRevealed(bytes32 indexed queryHash);
    
    /// @notice Submit encrypted spatiotemporal point
    function submitEncryptedPoint(
        euint32 lat,
        euint32 lon,
        euint32 timestamp
    ) public {
        pointCount++;
        uint256 newId = pointCount;
        
        encryptedPoints[newId] = EncryptedPoint({
            id: newId,
            encryptedLat: lat,
            encryptedLon: lon,
            encryptedTimestamp: timestamp,
            submissionTime: block.timestamp
        });
        
        // Simplified spatial indexing (actual indexing would be more complex)
        uint32 gridCell = calculateGridCell(lat, lon);
        gridIndex[gridCell].push(newId);
        
        emit PointSubmitted(newId, block.timestamp);
    }
    
    /// @notice Execute range query
    function executeRangeQuery(
        euint32 centerLat,
        euint32 centerLon,
        euint32 radius,
        euint32 startTime,
        euint32 endTime
    ) public returns (bytes32) {
        bytes32 queryHash = keccak256(abi.encodePacked(centerLat, centerLon, radius, startTime, endTime, block.timestamp));
        
        emit QueryExecuted(queryHash);
        
        return queryHash;
    }
    
    /// @notice Store encrypted query results
    function storeQueryResults(
        bytes32 queryHash,
        uint256[] memory pointIds,
        euint32[] memory distances
    ) public {
        require(pointIds.length == distances.length, "Invalid results");
        
        queryResults[queryHash] = QueryResult({
            pointIds: pointIds,
            distances: distances,
            isComplete: true
        });
        
        decryptedResults[queryHash] = DecryptedResult({
            pointIds: new uint256[](0),
            distances: new uint32[](0),
            isRevealed: false
        });
    }
    
    /// @notice Request decryption of query results
    function requestResultDecryption(bytes32 queryHash) public {
        QueryResult storage result = queryResults[queryHash];
        require(result.isComplete, "Query not complete");
        require(!decryptedResults[queryHash].isRevealed, "Already revealed");
        
        // Prepare all ciphertexts for decryption
        bytes32[] memory ciphertexts = new bytes32[](result.distances.length);
        for (uint i = 0; i < result.distances.length; i++) {
            ciphertexts[i] = FHE.toBytes32(result.distances[i]);
        }
        
        // Request decryption
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptQueryResult.selector);
        requestToQueryHash[reqId] = queryHash;
    }
    
    /// @notice Callback for decrypted query results
    function decryptQueryResult(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        bytes32 queryHash = requestToQueryHash[requestId];
        require(queryHash != 0, "Invalid request");
        
        QueryResult storage qResult = queryResults[queryHash];
        DecryptedResult storage dResult = decryptedResults[queryHash];
        require(!dResult.isRevealed, "Already revealed");
        
        // Verify decryption proof
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        // Process decrypted values
        uint32[] memory distances = abi.decode(cleartexts, (uint32[]));
        
        dResult.pointIds = qResult.pointIds;
        dResult.distances = distances;
        dResult.isRevealed = true;
        
        emit ResultRevealed(queryHash);
    }
    
    /// @notice Calculate Haversine distance (encrypted)
    function calculateDistance(
        euint32 lat1,
        euint32 lon1,
        euint32 lat2,
        euint32 lon2
    ) public pure returns (euint32) {
        // Simplified distance calculation (actual Haversine would be more complex)
        euint32 dLat = FHE.sub(lat2, lat1);
        euint32 dLon = FHE.sub(lon2, lon1);
        
        euint32 dLatSq = FHE.mul(dLat, dLat);
        euint32 dLonSq = FHE.mul(dLon, dLon);
        
        return FHE.sqrt(FHE.add(dLatSq, dLonSq));
    }
    
    /// @notice Check if point is within time range (encrypted)
    function isWithinTimeRange(
        euint32 pointTime,
        euint32 startTime,
        euint32 endTime
    ) public pure returns (ebool) {
        ebool afterStart = FHE.ge(pointTime, startTime);
        ebool beforeEnd = FHE.le(pointTime, endTime);
        return FHE.and(afterStart, beforeEnd);
    }
    
    /// @notice Check if point is within spatial range (encrypted)
    function isWithinSpatialRange(
        euint32 pointLat,
        euint32 pointLon,
        euint32 centerLat,
        euint32 centerLon,
        euint32 radius
    ) public pure returns (ebool) {
        euint32 distance = calculateDistance(pointLat, pointLon, centerLat, centerLon);
        return FHE.le(distance, radius);
    }
    
    /// @notice Find nearest neighbor (simplified)
    function findNearestNeighbor(
        euint32 targetLat,
        euint32 targetLon
    ) public view returns (euint32) {
        euint32 minDistance = FHE.asEuint32(type(uint32).max);
        euint32 nearestId = FHE.asEuint32(0);
        
        for (uint i = 1; i <= pointCount; i++) {
            EncryptedPoint storage point = encryptedPoints[i];
            euint32 dist = calculateDistance(point.encryptedLat, point.encryptedLon, targetLat, targetLon);
            
            ebool isCloser = FHE.lt(dist, minDistance);
            minDistance = FHE.select(isCloser, dist, minDistance);
            nearestId = FHE.select(isCloser, FHE.asEuint32(i), nearestId);
        }
        
        return nearestId;
    }
    
    /// @notice Get encrypted point data
    function getEncryptedPoint(uint256 pointId) public view returns (
        euint32 lat,
        euint32 lon,
        euint32 timestamp
    ) {
        EncryptedPoint storage p = encryptedPoints[pointId];
        require(p.submissionTime > 0, "Point not found");
        return (p.encryptedLat, p.encryptedLon, p.encryptedTimestamp);
    }
    
    /// @notice Get encrypted query result
    function getEncryptedQueryResult(bytes32 queryHash) public view returns (
        uint256[] memory pointIds,
        euint32[] memory distances
    ) {
        QueryResult storage r = queryResults[queryHash];
        require(r.isComplete, "Query not complete");
        return (r.pointIds, r.distances);
    }
    
    /// @notice Get decrypted query result
    function getDecryptedQueryResult(bytes32 queryHash) public view returns (
        uint256[] memory pointIds,
        uint32[] memory distances,
        bool isRevealed
    ) {
        DecryptedResult storage r = decryptedResults[queryHash];
        return (r.pointIds, r.distances, r.isRevealed);
    }
    
    // Helper functions
    function calculateGridCell(euint32 lat, euint32 lon) private pure returns (uint32) {
        // Simplified grid cell calculation (actual would use geohash or similar)
        return uint32(FHE.decrypt(FHE.add(FHE.mul(lat, FHE.asEuint32(100)), lon)));
    }
    
    /// @notice Convert degrees to radians (simplified)
    function toRadians(euint32 degrees) private pure returns (euint32) {
        return FHE.div(FHE.mul(degrees, FHE.asEuint32(314159)), FHE.asEuint32(18000000));
    }
}