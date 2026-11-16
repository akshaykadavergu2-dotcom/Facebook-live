package com.livecast.capture.studio.ui

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.livecast.capture.MainActivity

class StudioHomeActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            StreamKaroTheme {
                StudioHomeScreen(
                    onOpenExistingStudio = {
                        startActivity(Intent(this, MainActivity::class.java))
                    },
                )
            }
        }
    }
}

private val Ink = Color(0xFF080B18)
private val Panel = Color(0xFF151B30)
private val Muted = Color(0xFF9BA7C4)
private val Cyan = Color(0xFF39D7F2)
private val Violet = Color(0xFF8B6CFF)
private val Pink = Color(0xFFFF6BB5)

@Composable
private fun StreamKaroTheme(content: @Composable () -> Unit) {
    MaterialTheme(content = content)
}

@Composable
private fun StudioHomeScreen(onOpenExistingStudio: () -> Unit) {
    Surface(modifier = Modifier.fillMaxSize(), color = Ink) {
        Column(
            modifier = Modifier.fillMaxSize().padding(horizontal = 20.dp, vertical = 22.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier.size(46.dp).background(
                        Brush.linearGradient(listOf(Cyan, Violet, Pink)),
                        RoundedCornerShape(15.dp),
                    ),
                    contentAlignment = Alignment.Center,
                ) {
                    Text("SK", color = Ink, fontWeight = FontWeight.Black, fontSize = 17.sp)
                }
                Spacer(Modifier.width(12.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text("STREAMKARO", color = Color.White, fontSize = 19.sp, fontWeight = FontWeight.Black, letterSpacing = 1.2.sp)
                    Text("STUDIO  •  MOBILE BROADCAST", color = Muted, fontSize = 10.sp, letterSpacing = 1.sp)
                }
                Text("● OFFLINE", color = Cyan, fontSize = 10.sp, fontWeight = FontWeight.Bold)
            }

            Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
                Text("Your broadcast.", color = Color.White, fontSize = 29.sp, fontWeight = FontWeight.ExtraBold)
                Text("Your production control room.", color = Muted, fontSize = 15.sp)
            }

            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(24.dp),
                colors = CardDefaults.cardColors(containerColor = Panel),
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("PROGRAM PREVIEW", color = Muted, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp)
                        Spacer(Modifier.weight(1f))
                        Text("1080p  •  30 FPS", color = Cyan, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                    }
                    Spacer(Modifier.height(12.dp))
                    Box(
                        modifier = Modifier.fillMaxWidth().height(178.dp).background(
                            Brush.linearGradient(listOf(Color(0xFF18284A), Color(0xFF35245E), Color(0xFF10182B))),
                            RoundedCornerShape(16.dp),
                        ),
                        contentAlignment = Alignment.Center,
                    ) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Text("▶", color = Cyan, fontSize = 30.sp)
                            Text("PRODUCTION CANVAS", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 13.sp)
                            Text("Your scenes and sources appear here", color = Muted, fontSize = 10.sp)
                        }
                        Text("PREVIEW", color = Color.White, fontSize = 9.sp, modifier = Modifier.align(Alignment.TopStart).padding(12.dp))
                    }
                    Spacer(Modifier.height(14.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                        MetricChip("SCENES", "01", Modifier.weight(1f))
                        MetricChip("SOURCES", "00", Modifier.weight(1f))
                        MetricChip("DROPPED", "0", Modifier.weight(1f))
                    }
                }
            }

            Text("PRODUCTION TOOLS", color = Muted, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.2.sp)
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                ToolCard("▣", "Scenes", "Switch layouts", Cyan, Modifier.weight(1f))
                ToolCard("◈", "Sources", "Camera & media", Violet, Modifier.weight(1f))
                ToolCard("≋", "Audio", "Mixer & filters", Pink, Modifier.weight(1f))
            }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                ToolCard("✦", "Graphics", "Titles & overlays", Pink, Modifier.weight(1f))
                ToolCard("⇧", "Stream", "Destinations", Cyan, Modifier.weight(1f))
                ToolCard("⚙", "Settings", "Output profiles", Violet, Modifier.weight(1f))
            }

            Spacer(Modifier.weight(1f))
            Button(
                onClick = onOpenExistingStudio,
                modifier = Modifier.fillMaxWidth().height(54.dp),
                shape = RoundedCornerShape(16.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Violet),
            ) {
                Text("OPEN BROADCAST STUDIO  →", fontWeight = FontWeight.Bold, letterSpacing = 0.5.sp)
            }
            Text(
                "Foundation build • Existing capture, mixer and output tools are preserved",
                color = Muted,
                fontSize = 10.sp,
                modifier = Modifier.align(Alignment.CenterHorizontally),
            )
        }
    }
}

@Composable
private fun MetricChip(label: String, value: String, modifier: Modifier = Modifier) {
    Column(modifier.background(Color(0xFF202943), RoundedCornerShape(12.dp)).padding(10.dp)) {
        Text(value, color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Bold)
        Text(label, color = Muted, fontSize = 9.sp, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun ToolCard(icon: String, title: String, subtitle: String, accent: Color, modifier: Modifier = Modifier) {
    Card(modifier = modifier.height(104.dp), shape = RoundedCornerShape(16.dp), colors = CardDefaults.cardColors(containerColor = Panel)) {
        Column(modifier = Modifier.fillMaxSize().padding(11.dp), verticalArrangement = Arrangement.SpaceBetween) {
            Text(icon, color = accent, fontSize = 21.sp, fontWeight = FontWeight.Bold)
            Column {
                Text(title, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 12.sp)
                Text(subtitle, color = Muted, fontSize = 9.sp)
            }
        }
    }
}
