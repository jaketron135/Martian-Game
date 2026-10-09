using UnityEngine;
using UnityEngine.Networking;
using System.Collections;
using System.Text;

public class TelegramGameBridge : MonoBehaviour
{
    private string serverUrl = "http://localhost:3000/api";
    public string telegramId = "123456789";

    public void ClaimMiningRewards()
    {
        StartCoroutine(PostRequest(serverUrl + "/base/claim-mining", "{\"telegramId\":\"" + telegramId + "\"}"));
    }

    public void UpgradeBuilding(string buildingType)
    {
        string jsonBody = "{\"telegramId\":\"" + telegramId + "\", \"buildingType\":\"" + buildingType + "\"}";
        StartCoroutine(PostRequest(serverUrl + "/base/upgrade", jsonBody));
    }

    public void ClaimAdReward(string rewardType)
    {
        string jsonBody = "{\"telegramId\":\"" + telegramId + "\", \"rewardType\":\"" + rewardType + "\"}";
        StartCoroutine(PostRequest(serverUrl + "/ads/reward-callback", jsonBody));
    }

    public void PlacePredictionBet(string asset, string direction, float stakeAmount)
    {
        string jsonBody = "{\"telegramId\":\"" + telegramId + "\", \"asset\":\"" + asset + "\", \"direction\":\"" + direction + "\", \"stakeAmount\":" + stakeAmount + "}";
        StartCoroutine(PostRequest(serverUrl + "/prediction/place-bet", jsonBody));
    }

    private IEnumerator PostRequest(string url, string jsonBody)
    {
        UnityWebRequest request = new UnityWebRequest(url, "POST");
        byte[] bodyRaw = Encoding.UTF8.GetBytes(jsonBody);
        request.uploadHandler = new UploadHandlerRaw(bodyRaw);
        request.downloadHandler = new DownloadHandlerBuffer();
        request.SetRequestHeader("Content-Type", "application/json");

        yield return request.SendWebRequest();

        if (request.result != UnityWebRequest.Result.Success)
        {
            Debug.LogError("Error: " + request.error);
        }
        else
        {
            Debug.Log("Server Response: " + request.downloadHandler.text);
        }
    }
}