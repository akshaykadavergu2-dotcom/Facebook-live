package com.livecast.capture.studio.model

import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/**
 * Platform-neutral project model. Keep this schema stable so the iOS app can
 * read and write the same project documents.
 */
data class StudioProject(
    val id: String = UUID.randomUUID().toString(),
    val name: String = "Untitled Broadcast",
    val canvasWidth: Int = 1920,
    val canvasHeight: Int = 1080,
    val frameRate: Int = 30,
    val scenes: List<StudioScene> = listOf(StudioScene(name = "Scene 1")),
    val activeSceneId: String? = null,
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("schemaVersion", 1)
        put("id", id)
        put("name", name)
        put("canvas", JSONObject().put("width", canvasWidth).put("height", canvasHeight))
        put("frameRate", frameRate)
        put("activeSceneId", activeSceneId)
        put("scenes", JSONArray().apply { scenes.forEach { put(it.toJson()) } })
    }

    companion object {
        fun fromJson(json: JSONObject): StudioProject {
            val canvas = json.optJSONObject("canvas") ?: JSONObject()
            val scenesJson = json.optJSONArray("scenes") ?: JSONArray()
            val scenes = buildList {
                for (index in 0 until scenesJson.length()) {
                    scenesJson.optJSONObject(index)?.let { add(StudioScene.fromJson(it)) }
                }
            }
            return StudioProject(
                id = json.optString("id").ifBlank { UUID.randomUUID().toString() },
                name = json.optString("name", "Untitled Broadcast"),
                canvasWidth = canvas.optInt("width", 1920),
                canvasHeight = canvas.optInt("height", 1080),
                frameRate = json.optInt("frameRate", 30),
                scenes = scenes.ifEmpty { listOf(StudioScene(name = "Scene 1")) },
                activeSceneId = json.optString("activeSceneId").takeIf { it.isNotBlank() },
            )
        }
    }
}

data class StudioScene(
    val id: String = UUID.randomUUID().toString(),
    val name: String,
    val sources: List<StudioSource> = emptyList(),
) {
    fun toJson() = JSONObject().apply {
        put("id", id)
        put("name", name)
        put("sources", JSONArray().apply { sources.forEach { put(it.toJson()) } })
    }

    companion object {
        fun fromJson(json: JSONObject): StudioScene {
            val items = json.optJSONArray("sources") ?: JSONArray()
            val sources = buildList {
                for (index in 0 until items.length()) {
                    items.optJSONObject(index)?.let { add(StudioSource.fromJson(it)) }
                }
            }
            return StudioScene(
                id = json.optString("id").ifBlank { UUID.randomUUID().toString() },
                name = json.optString("name", "Scene"),
                sources = sources,
            )
        }
    }
}

data class StudioSource(
    val id: String = UUID.randomUUID().toString(),
    val name: String,
    val type: SourceType,
    val enabled: Boolean = true,
    val x: Float = 0f,
    val y: Float = 0f,
    val width: Float = 1f,
    val height: Float = 1f,
    val zIndex: Int = 0,
) {
    fun toJson() = JSONObject().apply {
        put("id", id)
        put("name", name)
        put("type", type.name)
        put("enabled", enabled)
        put("transform", JSONObject().put("x", x).put("y", y).put("width", width).put("height", height))
        put("zIndex", zIndex)
    }

    companion object {
        fun fromJson(json: JSONObject): StudioSource {
            val transform = json.optJSONObject("transform") ?: JSONObject()
            val type = runCatching { SourceType.valueOf(json.optString("type")) }.getOrDefault(SourceType.MEDIA)
            return StudioSource(
                id = json.optString("id").ifBlank { UUID.randomUUID().toString() },
                name = json.optString("name", "Source"),
                type = type,
                enabled = json.optBoolean("enabled", true),
                x = transform.optDouble("x", 0.0).toFloat(),
                y = transform.optDouble("y", 0.0).toFloat(),
                width = transform.optDouble("width", 1.0).toFloat(),
                height = transform.optDouble("height", 1.0).toFloat(),
                zIndex = json.optInt("zIndex", 0),
            )
        }
    }
}

enum class SourceType { CAMERA, SCREEN, IMAGE, VIDEO, TEXT, BROWSER, AUDIO, COLOR, MEDIA }
