package com.livecast.capture.studio.storage

import android.content.Context
import com.livecast.capture.studio.model.StudioProject
import org.json.JSONObject
import java.io.File

/** Local project persistence. Secrets such as stream keys must never be stored here. */
class StudioProjectRepository(context: Context) {
    private val projectsDir = File(context.filesDir, "studio-projects").apply { mkdirs() }

    fun save(project: StudioProject): File {
        val destination = File(projectsDir, "${project.id}.json")
        val temporary = File(projectsDir, "${project.id}.json.tmp")
        temporary.writeText(project.toJson().toString(2))
        if (destination.exists() && !destination.delete()) {
            temporary.delete()
            error("Unable to replace project file")
        }
        check(temporary.renameTo(destination)) { "Unable to save project file" }
        return destination
    }

    fun load(projectId: String): StudioProject? {
        val file = File(projectsDir, "${projectId}.json")
        if (!file.isFile) return null
        return runCatching { StudioProject.fromJson(JSONObject(file.readText())) }.getOrNull()
    }

    fun list(): List<StudioProject> = projectsDir.listFiles()
        ?.filter { it.isFile && it.extension == "json" }
        ?.mapNotNull { file ->
            runCatching { StudioProject.fromJson(JSONObject(file.readText())) }.getOrNull()
        }
        .orEmpty()
        .sortedBy { it.name.lowercase() }
}
